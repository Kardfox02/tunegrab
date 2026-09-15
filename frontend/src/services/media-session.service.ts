import type { Track } from '@/types/track'

export interface MediaSessionHandlers {
  onPlay(): void
  onPause(): void
  onNext(): void
  onPrevious(): void
}

interface MediaSessionCapabilities {
  setMetadata(metadata: MediaMetadata | null): void
  setPlaybackState(state: 'playing' | 'paused' | 'none'): void
  setActionHandler(action: string, handler: ((details?: unknown) => void) | null): void
}

export class MediaSessionService {
  private readonly handlers: MediaSessionHandlers
  private capabilities: MediaSessionCapabilities | null

  constructor(handlers: MediaSessionHandlers, navigatorApi: Navigator = window.navigator) {
    this.handlers = handlers
    // typeof null === 'object', поэтому явная проверка на null обязательна:
    // 'mediaSession' in null бросил бы TypeError.
    if (navigatorApi === null || typeof navigatorApi !== 'object' || !('mediaSession' in navigatorApi)) {
      this.capabilities = null
      return
    }

    const mediaSession = navigatorApi.mediaSession
    this.capabilities = {
      setMetadata(metadata) {
        mediaSession.metadata = metadata
      },
      setPlaybackState(state) {
        mediaSession.playbackState = state
      },
      setActionHandler(action, handler) {
        try {
          mediaSession.setActionHandler(action as MediaSessionAction, handler as MediaSessionActionHandler)
        } catch {
          // Действие не поддерживается текущим браузером — молча пропускаем.
        }
      },
    }
  }

  setTrack(track: Track | null): void {
    if (!this.capabilities) {
      return
    }

    if (track === null) {
      this.capabilities.setMetadata(null)
      this.capabilities.setPlaybackState('none')
      return
    }

    const artwork =
      typeof track.cover_url === 'string' && track.cover_url.length > 0
        ? [{ src: track.cover_url, sizes: '512x512' }]
        : []

    // Safari/WebKit фиксирует состав кнопок системного медиаконтроллера
    // в момент установки metadata — обработчики навешиваем строго раньше.
    this.bindHandlers()
    // Сборки с mediaSession, но без конструктора MediaMetadata (старый
    // WebKit): new MediaMetadata упал бы ReferenceError внутри setTrack.
    if (typeof MediaMetadata === 'undefined') {
      return
    }
    this.capabilities.setMetadata(
      new MediaMetadata({
        title: track.title,
        artist: track.author,
        album: 'Tunegrab',
        artwork,
      }),
    )
  }

  setPlaying(): void {
    if (!this.capabilities) {
      return
    }

    // Safari/WebKit игнорирует обработчики, зарегистрированные до начала
    // воспроизведения, поэтому (пере)регистрируем их в момент события playing.
    this.bindHandlers()
    this.capabilities.setPlaybackState('playing')
  }

  setPaused(): void {
    if (this.capabilities) {
      this.capabilities.setPlaybackState('paused')
    }
  }

  dispose(): void {
    if (!this.capabilities) {
      return
    }

    this.capabilities.setMetadata(null)
    this.capabilities.setPlaybackState('none')
    // Снимаем и обработчики: иначе системные кнопки медиаконтроллера
    // продолжали бы будить «мертвую» сессию после teardown.
    this.capabilities.setActionHandler('play', null)
    this.capabilities.setActionHandler('pause', null)
    this.capabilities.setActionHandler('previoustrack', null)
    this.capabilities.setActionHandler('nexttrack', null)
    this.capabilities.setActionHandler('stop', null)
  }

  private bindHandlers(): void {
    if (!this.capabilities) {
      return
    }

    this.capabilities.setActionHandler('play', this.handlers.onPlay)
    this.capabilities.setActionHandler('pause', this.handlers.onPause)
    this.capabilities.setActionHandler('previoustrack', this.handlers.onPrevious)
    this.capabilities.setActionHandler('nexttrack', this.handlers.onNext)
    this.capabilities.setActionHandler('stop', this.handlers.onPause)
  }
}
