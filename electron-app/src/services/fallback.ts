/**
 * 兜底链 provider —— 移植自 lib/services/fallback_music_provider.dart。
 * 主源失败/超时（180ms）时回落到备用源；详情/取链按 id 前缀分派。
 */

import type { MusicProvider, RawSong } from './musicProvider'
import type { PlaybackUrl } from './models'
import { defaultGetLyrics } from './musicProvider'

export class FallbackMusicProvider implements MusicProvider {
  constructor(
    private readonly primary: MusicProvider,
    private readonly fallback: MusicProvider,
    private readonly isPrimaryId: (id: string) => boolean = (id) =>
      id.startsWith('bilibili:'),
  ) {}

  rememberSongs(songs: RawSong[]): void {
    this.primary.rememberSongs?.(songs)
    this.fallback.rememberSongs?.(songs)
  }

  async searchSongs(query: string, page = 1): Promise<RawSong[]> {
    try {
      const songs = await this.primary.searchSongs(query, page)
      if (songs.length > 0) return songs
    } catch {
      // 主源不可用，落到备用源
    }
    try {
      return await this.fallback.searchSongs(query, page)
    } catch {
      return []
    }
  }

  async getRecommendedSongs(page = 1): Promise<RawSong[]> {
    const primaryFuture = this.primary.getRecommendedSongs(page).catch(() => [] as RawSong[])
    const fallbackFuture = this.fallback.getRecommendedSongs(page).catch(() => [] as RawSong[])

    const primaryFirst = await raceWithTimeout(primaryFuture, 180)
    if (primaryFirst.length > 0) return primaryFirst

    const fallbackSongs = await fallbackFuture
    if (fallbackSongs.length > 0) return fallbackSongs

    return primaryFuture
  }

  async getHotPlaylists(opts?: { limit?: number; offset?: number }): Promise<RawSong[]> {
    const primaryFuture = this.primary.getHotPlaylists(opts).catch(() => [] as RawSong[])
    const fallbackFuture = this.fallback.getHotPlaylists(opts).catch(() => [] as RawSong[])

    const primaryFirst = await raceWithTimeout(primaryFuture, 180)
    if (primaryFirst.length > 0) return primaryFirst

    const fallbackPlaylists = await fallbackFuture
    if (fallbackPlaylists.length > 0) return fallbackPlaylists

    return primaryFuture
  }

  getPlaylist(id: string, limit?: number): Promise<RawSong> {
    return this.isPrimaryId(id)
      ? this.primary.getPlaylist(id, limit)
      : this.fallback.getPlaylist(id, limit)
  }

  getSongDetail(id: string): Promise<RawSong> {
    return this.isPrimaryId(id)
      ? this.primary.getSongDetail(id)
      : this.fallback.getSongDetail(id)
  }

  getPlayUrl(id: string): Promise<PlaybackUrl> {
    return this.isPrimaryId(id)
      ? this.primary.getPlayUrl(id)
      : this.fallback.getPlayUrl(id)
  }

  getLyrics(song: RawSong): Promise<string> {
    const id = song['id']?.toString() ?? ''
    if (this.isPrimaryId(id)) {
      return this.primary.getLyrics?.(song) ?? defaultGetLyrics(song)
    }
    return this.fallback.getLyrics?.(song) ?? defaultGetLyrics(song)
  }
}

/** 等待 promise，最多 timeoutMs；超时返回空数组（原 promise 继续在后台跑） */
export function raceWithTimeout<T>(
  promise: Promise<T[]>,
  timeoutMs: number,
): Promise<T[]> {
  return Promise.race([
    promise,
    new Promise<T[]>((resolve) => setTimeout(() => resolve([]), timeoutMs)),
  ])
}
