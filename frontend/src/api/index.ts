export { apiClient } from './client'
export type { AbortGroup, UnauthorizedHandler } from './client'
export { createAbortGroup, hasArray, hasNumber, hasString, isApiObject, request, setUnauthorizedHandler } from './client'
export {
  changePassword,
  getCurrentUser,
  login,
  logout,
  register,
} from './auth-api'
export {
  cancelDownload,
  fetchActiveDownloads,
  fetchDownloadStatus,
  queueDownload,
  retryDownload,
  searchYouTube,
} from './youtube-api'
export { deleteTrack, listTracks, uploadTrack } from './tracks-api'
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
  subscribeToSharedPlaylist,
  unsubscribeFromPlaylist,
} from './playlists-api'
export { addLike, fetchLikedTrackIds, fetchLikes, removeLike } from './likes-api'
export { fetchListeningStats, recordListenEvent } from './events-api'
export { clearThumbnails, fetchAdminHealth, runCleanupOrphans, runVerifyStorage } from './admin-api'
