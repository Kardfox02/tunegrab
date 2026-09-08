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
    if (typeof navigatorApi !== 'object' || !('mediaSession' in navigatorApi)) {
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
