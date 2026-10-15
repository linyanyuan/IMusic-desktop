/**
 * Provider 抽象 —— 移植自 lib/services/music_provider.dart。
 * RawSong 对应 Dart 的 Map<String, dynamic>。
 */

import type { PlaybackUrl } from './models'

export type RawSong = Record<string, unknown>

export interface MusicProvider {
  /** 缓存搜索结果，供后续播放/歌词解析引用 */
  rememberSongs?(songs: RawSong[]): void

  /** 获取歌词（默认取 song.lyrics） */
  getLyrics?(song: RawSong): Promise<string>

  /** 搜索单曲/歌单；page 为 1 基，不支持分页的 provider 忽略 */
  searchSongs(query: string, page?: number): Promise<RawSong[]>

  getRecommendedSongs(page?: number): Promise<RawSong[]>

  getHotPlaylists(opts?: { limit?: number; offset?: number }): Promise<RawSong[]>

  getPlaylist(id: string, limit?: number): Promise<RawSong>

  getSongDetail(id: string): Promise<RawSong>

  getPlayUrl(id: string): Promise<PlaybackUrl>
}

export type PlaylistSummaryKind =
  | 'multiPage'
  | 'singleLongCollection'
  | 'singlePageCollection'

export interface PlaylistSummary {
  available: boolean
  kind?: PlaylistSummaryKind
  songCount: number
  durationSeconds: number
}

export const UNAVAILABLE_PLAYLIST_SUMMARY: PlaylistSummary = {
  available: false,
  songCount: 0,
  durationSeconds: 0,
}

export interface PlaylistSummaryProvider extends MusicProvider {
  getPlaylistSummary(playlist: RawSong): Promise<PlaylistSummary>
}

export interface PlaybackIdResolver extends MusicProvider {
  resolvePlaybackId(song: RawSong): Promise<string>
}

export function isPlaylistSummaryProvider(
  p: MusicProvider,
): p is PlaylistSummaryProvider {
  return typeof (p as PlaylistSummaryProvider).getPlaylistSummary === 'function'
}

export function isPlaybackIdResolver(p: MusicProvider): p is PlaybackIdResolver {
  return typeof (p as PlaybackIdResolver).resolvePlaybackId === 'function'
}

/** MusicProviderPlaylistSummary 扩展方法等价物 */
export async function getPlaylistSummaryOf(
  provider: MusicProvider,
  playlist: RawSong,
): Promise<PlaylistSummary> {
  if (isPlaylistSummaryProvider(provider)) {
    return provider.getPlaylistSummary(playlist)
  }
  return UNAVAILABLE_PLAYLIST_SUMMARY
}

/** MusicProviderPlaybackId 扩展方法等价物 */
export async function resolvePlaybackIdOf(
  provider: MusicProvider,
  song: RawSong,
): Promise<string> {
  if (isPlaybackIdResolver(provider)) {
    return provider.resolvePlaybackId(song)
  }
  const playbackId = song['playbackId']?.toString().trim() ?? ''
  return playbackId !== '' ? playbackId : (song['id']?.toString().trim() ?? '')
}

/** 默认 getLyrics 行为 */
export async function defaultGetLyrics(song: RawSong): Promise<string> {
  return song['lyrics']?.toString().trim() ?? ''
}
