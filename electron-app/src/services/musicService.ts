/**
 * MusicService —— 移植自 lib/services/music_service.dart。
 * 对外唯一入口：聚合 HybridMusicProvider（metadata Fallback(Meting→Default)
 * + playback Bilibili + GDStudio client + Chksz）。
 */

import type { MusicProvider, RawSong, PlaylistSummary } from './musicProvider'
import type { PlaybackUrl } from './models'
import { MusicSearchScope } from './models'
import {
  getPlaylistSummaryOf,
  resolvePlaybackIdOf,
  defaultGetLyrics,
} from './musicProvider'
import { HybridMusicProvider } from './hybrid'
import { type CategoryPlaylistOptions } from './netease'
import { FallbackMusicProvider } from './fallback'
import { GdStudioMusicClient } from './gdstudio'
import { MetingMusicProvider, DefaultMusicProvider } from './meting'
import { BilibiliMusicProvider } from './bilibili'
import { createChkszResolver } from './chksz'
import { NeteasePublicClient } from './netease'

/**
 * 兜底过滤「空载荷 id」的条目（如 `bilibili:`、`gdstudio::`）。
 * 上游搜索会混入 B 站课堂/番剧/影视等没有 bvid 的结果，provider 层已按来源剔除，
 * 这里对 Gateway 推荐、热点歌单等其它来源再兜一层，避免空 id 流入 UI 与播放链路。
 */
function dropUnplayableSongs(songs: RawSong[]): RawSong[] {
  return songs.filter((song) => {
    const segments = String(song.id ?? '')
      .split(':')
      .slice(1)
    return segments.length === 0 || segments.some((seg) => seg.trim() !== '')
  })
}

export class MusicService {
  constructor(private readonly provider: MusicProvider) {}

  rememberSongs(songs: RawSong[]): void {
    this.provider.rememberSongs?.(songs)
  }

  searchSongs(
    query: string,
    page = 1,
    scope: MusicSearchScope = MusicSearchScope.All,
  ): Promise<RawSong[]> {
    return this.searchSongsByScope(query, page, scope).then(dropUnplayableSongs)
  }

  private searchSongsByScope(
    query: string,
    page: number,
    scope: MusicSearchScope,
  ): Promise<RawSong[]> {
    const hybrid =
      this.provider instanceof HybridMusicProvider ? this.provider : null
    switch (scope) {
      case MusicSearchScope.MetadataSongs:
        return (
          hybrid?.searchMetadataSongs(query, page) ??
          this.provider.searchSongs(query, page)
        )
      case MusicSearchScope.BilibiliPlaylists:
        return hybrid?.searchBilibiliPlaylists(query, page) ?? Promise.resolve([])
      case MusicSearchScope.ChkszSongs:
        return (
          hybrid?.searchChkszSongs(query, page) ??
          Promise.reject(new Error('ChKSz 未启用'))
        )
      case MusicSearchScope.All:
        return this.provider.searchSongs(query, page)
    }
  }

  getRecommendedSongs(page = 1): Promise<RawSong[]> {
    return this.provider.getRecommendedSongs(page).then(dropUnplayableSongs)
  }

  getHotPlaylists(opts?: { limit?: number; offset?: number }): Promise<RawSong[]> {
    return this.provider.getHotPlaylists(opts).then(dropUnplayableSongs)
  }

  /**
   * 分类热门歌单（网易云公开接口）—— 非 Hybrid provider（如单测的假 provider）
   * 没有该能力时返回空数组，页面层自然落到空态。
   */
  getCategoryPlaylists(
    cat: string,
    opts?: CategoryPlaylistOptions,
  ): Promise<RawSong[]> {
    const hybrid =
      this.provider instanceof HybridMusicProvider ? this.provider : null
    if (hybrid == null) return Promise.resolve([])
    return hybrid.getCategoryPlaylists(cat, opts).then(dropUnplayableSongs)
  }

  /** 分类热门单曲（交错去重后约 30 首） */
  getCategorySongs(cat: string, page = 1): Promise<RawSong[]> {
    const hybrid =
      this.provider instanceof HybridMusicProvider ? this.provider : null
    if (hybrid == null) return Promise.resolve([])
    return hybrid.getCategorySongs(cat, page).then(dropUnplayableSongs)
  }

  /**
   * 基于口味偏好的个性化推荐；无偏好或全部失败时 provider 内部已回退
   * 默认推荐 feed（getRecommendedSongs）。
   */
  getPersonalizedSongs(genreKeys: string[], page = 1): Promise<RawSong[]> {
    const hybrid =
      this.provider instanceof HybridMusicProvider ? this.provider : null
    if (hybrid == null || genreKeys.length === 0) {
      return this.getRecommendedSongs(page)
    }
    return hybrid.getPersonalizedSongs(genreKeys, page).then(dropUnplayableSongs)
  }

  getPlaylist(id: string, limit?: number): Promise<RawSong> {
    return this.provider.getPlaylist(id, limit)
  }

  getPlaylistSummary(playlist: RawSong): Promise<PlaylistSummary> {
    return getPlaylistSummaryOf(this.provider, playlist)
  }

  resolvePlaybackId(song: RawSong): Promise<string> {
    return resolvePlaybackIdOf(this.provider, song)
  }

  getSongDetail(id: string): Promise<RawSong> {
    return this.provider.getSongDetail(id)
  }

  getPlayUrl(id: string): Promise<PlaybackUrl> {
    return this.provider.getPlayUrl(id)
  }

  getLyrics(song: RawSong): Promise<string> {
    return this.provider.getLyrics?.(song) ?? defaultGetLyrics(song)
  }
}

export interface MusicServiceDeps {
  /** Bearer token（meting 后端鉴权） */
  tokenProvider: () => string
  /** ChKSz key provider；返回 '' 表示未配置（ChKSz 源不启用）。每次取用都会重新询问 */
  chkszApiKeyProvider: () => string
  metingBaseUrl?: string
}

/** 组装完整服务（等价 Flutter 的 musicServiceProvider） */
export function createMusicService(deps: MusicServiceDeps): MusicService {
  const metadata = new FallbackMusicProvider(
    new MetingMusicProvider({
      baseUrl: deps.metingBaseUrl,
      tokenProvider: deps.tokenProvider,
    }),
    new DefaultMusicProvider(),
    // 元数据链的主源是 Meting：必须覆盖默认的 bilibili: 判定，
    // 否则 meting:* / meting-artist:* 会被路由到 DefaultMusicProvider
    // （Dart 端 music_service.dart 同步传入该谓词）。
    (id) => id.startsWith('meting:') || id.startsWith('meting-artist:'),
  )
  const playback = new BilibiliMusicProvider()
  const gdStudio = new GdStudioMusicClient()
  // 解析器而不是快照：设置页改了 key 立即生效（对应 Dart 端 provider 重建）
  const chksz = createChkszResolver(deps.chkszApiKeyProvider)
  return new MusicService(
    new HybridMusicProvider(metadata, playback, gdStudio, chksz, new NeteasePublicClient()),
  )
}
