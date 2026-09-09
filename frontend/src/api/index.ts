export { apiClient } from './client'
export type { AbortGroup, UnauthorizedHandler } from './client'
export { createAbortGroup, setUnauthorizedHandler } from './client'
export {
  changePassword,
  getCurrentUser,
  login,
  logout,
  register,
} from './auth-api'
export { queueDownload, searchYouTube } from './youtube-api'
export {
  cancelDownload,
  fetchActiveDownloads,
  fetchDownloadStatus,
  retryDownload,
} from './youtube-api'
export { deleteTrack, listTracks } from './tracks-api'
export {
  addPlaylistTrack,
  createPlaylist,
  createShareLink,
  deletePlaylist,
  fetchPlaylist,
  fetchPlaylists,
  fetchSharedPlaylist,
  removePlaylistTrack,
  renamePlaylist,
  reorderPlaylistTracks,
  revokeShareLink,
} from './playlists-api'
