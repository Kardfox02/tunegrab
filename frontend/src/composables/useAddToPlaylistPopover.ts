import { ref, type Ref } from 'vue'

import { usePlaylistsStore } from '@/stores/playlists.store'
import type { Track } from '@/types/track'

interface UseAddToPlaylistPopoverResult {
  /** Трек, для которого открыт поповер (null — закрыт). */
  track: Ref<Track | null>
  /** Открыть поповер для трека. */
  open: (track: Track) => void
  /** Закрыть поповер без действия. */
  close: () => void
  /** Выбор плейлиста: добавляет трек и закрывает поповер. */
  choose: (playlistId: number) => Promise<void>
}

/**
 * Проводка поповера «Добавить в плейлист» (ref + открытие + выбор плейлиста).
 * Идентична в LibraryView и ProfileView: общий composable устраняет дубль
 * и удерживает одну точку знания о закрытии поповера после add.
 */
export function useAddToPlaylistPopover(): UseAddToPlaylistPopoverResult {
  const playlists = usePlaylistsStore()
  const track = ref<Track | null>(null)

  function open(selected: Track): void {
    track.value = selected
  }

  function close(): void {
    track.value = null
  }

  async function choose(playlistId: number): Promise<void> {
    const selected = track.value
    if (!selected) {
      return
    }
    close()
    await playlists.addTrack(playlistId, selected.id)
  }

  return { track, open, close, choose }
}
