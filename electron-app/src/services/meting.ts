/**
 * Meting / Default provider —— 移植自
 * lib/services/meting_music_provider.dart 与 lib/services/default_music_provider.dart。
 *
 * - MetingMusicProvider：仅元数据（搜索/详情/歌词），不提供播放地址（抛错）。
 * - DefaultMusicProvider：经 Karpov Gateway 代理访问 QQMusic 等源的元数据+取链。
 *
 * HTTP 用全局 fetch + AbortController（Dio 10s/15s 超时的等价整体超时）。
 */

import type { MusicProvider, RawSong } from './musicProvider'
import type { PlaybackUrl } from './models'
import { playbackUrl } from './models'

/**
 * GET JSON，整体超时 timeoutMs。
 * 非 2xx 或 JSON 解析失败时抛错（等价 Dio 默认 validateStatus/解析行为）。
 */
async function fetchJson(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers, signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

function mapValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function listValue(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

/** Dart int.tryParse 等价：仅接受可选符号 + 纯数字 */
function intValue(value: unknown): number {
  if (typeof value === 'number') return Math.round(value)
  const text = value?.toString() ?? ''
  return /^[+-]?\d+$/.test(text.trim()) ? Number.parseInt(text.trim(), 10) : 0
}

function unsupported(message: string): Error {
  const err = new Error(message)
  err.name = 'UnsupportedError'
  return err
}

// ================= MetingMusicProvider =================

export interface MetingMusicProviderOptions {
  baseUrl?: string
  /** Dart 里是 ref.read(authTokenProvider)；非空时加 Authorization: Bearer */
  tokenProvider?: () => string | null | undefined
}

interface MetingId {
  vendor: string
  rawId: string
}

interface MetingCollectionId {
  kind: string
  vendor: string
  rawId: string
}

/**
 * Meting music provider - 元数据与歌词来自 meting API。
 * 仅元数据 provider：可搜索、给详情，但不提供播放地址（抛 UnsupportedError）。
 */
export class MetingMusicProvider implements MusicProvider {
  static readonly defaultBaseUrl = 'http://60.205.218.90:8787/api'

  /** Dio connect/receive timeout 的等价整体超时 */
  static readonly requestTimeoutMs = 10000

  private readonly baseUrl: string
  private readonly tokenProvider: (() => string | null | undefined) | undefined
  private readonly artistTitles = new Map<string, string>()

  constructor(opts: MetingMusicProviderOptions = {}) {
    this.baseUrl = opts.baseUrl ?? MetingMusicProvider.defaultBaseUrl
    this.tokenProvider = opts.tokenProvider
  }

  private requestHeaders(): Record<string, string> {
    const token = this.tokenProvider?.()?.trim() ?? ''
    return token === '' ? {} : { Authorization: `Bearer ${token}` }
  }

  rememberSongs(_songs: RawSong[]): void {}

  async searchSongs(query: string, page = 1): Promise<RawSong[]> {
    const keywords = query.trim()
    if (keywords === '') return []
    // 上游 meting 搜索没有稳定分页；只有第 1 页有用
    if (page > 1) return []

    // 先搜 tencent
    const tencent = await this.searchVendor('tencent', keywords)
    if (tencent.length === 0) return this.searchVendor('kugou', keywords)
    if (tencent.some(isArtistResult)) return tencent

    // tencent 里没有艺人结果时试 kugou
    const kugou = await this.searchVendor('kugou', keywords)
    const kugouArtists = kugou.filter(isArtistResult)
    if (kugouArtists.length === 0) {
      return tencent
    }
    // kugou 艺人结果在前，tencent 歌曲在后
    return [...kugouArtists, ...tencent]
  }

  getRecommendedSongs(): Promise<RawSong[]> {
    return this.searchSongs('热门音乐')
  }

  async getHotPlaylists(_opts?: {
    limit?: number
    offset?: number
  }): Promise<RawSong[]> {
    return []
  }

  async getPlaylist(id: string, limit?: number): Promise<RawSong> {
    const parsed = MetingMusicProvider.parseMetingCollectionId(id)
    if (parsed.kind !== 'artist') {
      throw unsupported('Meting provider does not expose playlists')
    }
    const artistTitle = this.artistTitles.get(id)?.trim() ?? ''
    const params = new URLSearchParams()
    if (artistTitle !== '') params.set('name', artistTitle)
    if (limit != null) params.set('limit', String(limit))
    const qs = params.toString()
    const body = await fetchJson(
      `${this.baseUrl}/music/artists/${parsed.vendor}/${encodeURIComponent(parsed.rawId)}${qs === '' ? '' : `?${qs}`}`,
      MetingMusicProvider.requestTimeoutMs,
      this.requestHeaders(),
    )
    const collection = mapValue(mapValue(body)?.['data']) ?? {}
    const songs = collection['songs']
    if (Array.isArray(songs)) {
      return {
        ...collection,
        songs: songs
          .filter((item): item is Record<string, unknown> => mapValue(item) != null)
          .map((item) => MetingMusicProvider.withCoverUrl(item)),
      }
    }
    return collection
  }

  async getSongDetail(id: string): Promise<RawSong> {
    const parsed = MetingMusicProvider.parseMetingId(id)
    const body = await fetchJson(
      `${this.baseUrl}/music/songs/${parsed.vendor}/${encodeURIComponent(parsed.rawId)}`,
      MetingMusicProvider.requestTimeoutMs,
      this.requestHeaders(),
    )
    const detail = mapValue(mapValue(body)?.['data']) ?? {}
    return MetingMusicProvider.withCoverUrl(detail)
  }

  async getPlayUrl(_id: string): Promise<PlaybackUrl> {
    throw unsupported('Meting provider is metadata-only')
  }

  async getLyrics(song: RawSong): Promise<string> {
    const existing = song['lyrics']?.toString().trim() ?? ''
    if (existing !== '') return existing
    const id = song['id']?.toString() ?? ''
    if (id === '') return ''
    const detail = await this.getSongDetail(id)
    return detail['lyrics']?.toString().trim() ?? ''
  }

  private async searchVendor(vendor: string, query: string): Promise<RawSong[]> {
    try {
      const params = new URLSearchParams({ vendor, q: query })
      const body = await fetchJson(
        `${this.baseUrl}/music/search?${params.toString()}`,
        MetingMusicProvider.requestTimeoutMs,
        this.requestHeaders(),
      )
      const data = mapValue(mapValue(body)?.['data'])
      const items = data?.['items']
      if (!Array.isArray(items)) return []
      const results = items
        .filter((item): item is Record<string, unknown> => mapValue(item) != null)
        .map((item) => MetingMusicProvider.withCoverUrl(item))
      // 记住艺人标题，供后续歌单查询使用
      for (const item of results.filter(isArtistResult)) {
        const id = item['id']?.toString() ?? ''
        const title = item['title']?.toString().trim() ?? ''
        if (id !== '' && title !== '') this.artistTitles.set(id, title)
      }
      return results
    } catch {
      return []
    }
  }

  private static parseMetingId(id: string): MetingId {
    const parts = id.split(':')
    if (parts.length < 3 || parts[0] !== 'meting') {
      throw new Error(`Expected meting:{vendor}:{id}, got: ${id}`)
    }
    return { vendor: parts[1], rawId: parts.slice(2).join(':') }
  }

  private static parseMetingCollectionId(id: string): MetingCollectionId {
    const parts = id.split(':')
    if (parts.length < 3 || !parts[0].startsWith('meting-')) {
      throw new Error(`Expected meting-artist:{vendor}:{id}, got: ${id}`)
    }
    return {
      kind: parts[0].substring('meting-'.length),
      vendor: parts[1],
      rawId: parts.slice(2).join(':'),
    }
  }

  /**
   * 把 meting 封面字段（picUrl / pic / pic_id）归一化为 coverUrl。
   * 裸 id 拼成 vendor CDN url；完整 url 直通（http:// 升级为 https://）。
   * 无 pic → 原样返回（走占位图）。
   */
  static withCoverUrl(item: Record<string, unknown>): RawSong {
    const existing = item['coverUrl']?.toString().trim() ?? ''
    if (existing !== '') return item

    const vendor =
      item['source']?.toString().trim() ??
      MetingMusicProvider.vendorFromId(item['id']?.toString() ?? '')
    // Dart 语义：字段存在（即使 trim 后为空）就短路，不再回退下一字段
    const rawField = item['picUrl'] ?? item['pic'] ?? item['pic_id']
    const raw = rawField != null ? rawField.toString().trim() : ''
    if (raw === '') return item

    let cover: string
    if (raw.startsWith('http://')) {
      cover = `https://${raw.substring(7)}`
    } else if (raw.startsWith('http')) {
      cover = raw
    } else {
      cover = MetingMusicProvider.vendorCoverUrl(vendor, raw)
    }
    if (cover === '') return item
    return { ...item, coverUrl: cover }
  }

  private static vendorFromId(id: string): string {
    // meting:{vendor}:{rawId}
    const parts = id.split(':')
    if (parts.length < 2 || parts[0] !== 'meting') return ''
    return parts[1]
  }

  private static vendorCoverUrl(vendor: string, picId: string): string {
    switch (vendor) {
      case 'tencent':
        return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${picId}.jpg`
      case 'netease':
        return `https://p2.music.126.net/${picId}.jpg`
      case 'kuwo':
        return `https://img1.kwcdn.kuwo.cn/star/albumcover/${picId}`
      case 'kugou':
        return `https://imgessl.kugou.com/cover/480/${picId}.jpg`
      default:
        return ''
    }
  }
}

function isArtistResult(item: RawSong): boolean {
  return item['resultType']?.toString() === 'artist'
}

// ================= DefaultMusicProvider =================

export interface DefaultMusicProviderOptions {
  source?: string
  baseUrl?: string
}

/**
 * Default music provider - 经 Karpov Gateway API 提供元数据与播放。
 * 通过代理网关访问 QQMusic 等源。
 */
export class DefaultMusicProvider implements MusicProvider {
  static readonly apiUrl = 'https://gateway.karpov.cn/api/proxy'
  static readonly defaultSource = 'qqmusic'
  static readonly defaultQuality = 'MP3_320'
  static readonly defaultRecommendationQuery = '热门'
  static readonly defaultHotPlaylistIds = ['8037641642', '7461724680']

  /** Dio connect/receive timeout 的等价整体超时 */
  static readonly requestTimeoutMs = 15000

  private readonly source: string
  private readonly baseUrl: string

  constructor(opts: DefaultMusicProviderOptions = {}) {
    this.source = opts.source ?? DefaultMusicProvider.defaultSource
    this.baseUrl = opts.baseUrl ?? DefaultMusicProvider.apiUrl
  }

  rememberSongs(_songs: RawSong[]): void {}

  async searchSongs(query: string, page = 1): Promise<RawSong[]> {
    const keywords = query.trim()
    if (keywords === '') return []
    const safePage = page < 1 ? 1 : page

    const params = new URLSearchParams({
      q: keywords,
      page: String(safePage),
      page_size: '30',
    })
    const body = await fetchJson(
      `${this.baseUrl}/${this.source}/search/songs?${params.toString()}`,
      DefaultMusicProvider.requestTimeoutMs,
    )
    return DefaultMusicProvider.parseSearchSongs(body)
  }

  getRecommendedSongs(): Promise<RawSong[]> {
    return this.searchSongs(DefaultMusicProvider.defaultRecommendationQuery)
  }

  async getHotPlaylists(_opts?: {
    limit?: number
    offset?: number
  }): Promise<RawSong[]> {
    // 返回空，让 HybridMusicProvider 回落到 BilibiliMusicProvider（有完整分页）
    return []
  }

  async getPlaylist(id: string, _limit?: number): Promise<RawSong> {
    const body = await fetchJson(
      `${this.baseUrl}/${this.source}/playlists/${encodeURIComponent(id)}`,
      DefaultMusicProvider.requestTimeoutMs,
    )
    return DefaultMusicProvider.parsePlaylist(
      DefaultMusicProvider.parseApiResponse(body)['data'],
    )
  }

  async getSongDetail(id: string): Promise<RawSong> {
    const body = await fetchJson(
      `${this.baseUrl}/${this.source}/songs/${encodeURIComponent(id)}`,
      DefaultMusicProvider.requestTimeoutMs,
    )
    return DefaultMusicProvider.parseSong(
      DefaultMusicProvider.parseApiResponse(body)['data'],
    )
  }

  async getPlayUrl(id: string): Promise<PlaybackUrl> {
    const params = new URLSearchParams({
      quality: DefaultMusicProvider.defaultQuality,
    })
    const body = await fetchJson(
      `${this.baseUrl}/${this.source}/songs/${encodeURIComponent(id)}/url?${params.toString()}`,
      DefaultMusicProvider.requestTimeoutMs,
    )
    return playbackUrl(
      DefaultMusicProvider.parsePlayUrl(
        DefaultMusicProvider.parseApiResponse(body),
      ),
    )
  }

  async getLyrics(song: RawSong): Promise<string> {
    const existing = song['lyrics']?.toString().trim() ?? ''
    if (existing !== '') return existing
    const id = song['id']?.toString() ?? ''
    if (id === '') return ''
    const detail = await this.getSongDetail(id)
    return detail['lyrics']?.toString().trim() ?? ''
  }

  private static parseApiResponse(data: unknown): Record<string, unknown> {
    const mapped = mapValue(data)
    if (mapped != null) return mapped
    throw new Error('接口返回了非 JSON 内容')
  }

  private static parseSearchSongs(data: unknown): RawSong[] {
    const json = DefaultMusicProvider.parseApiResponse(data)
    const envelopeData = mapValue(json['data'])
    const items = envelopeData?.['items']
    if (!Array.isArray(items)) return []
    return items
      .filter((item) => mapValue(item) != null)
      .map((item) => DefaultMusicProvider.parseSong(item))
  }

  private static parseSong(data: unknown): RawSong {
    const song = mapValue(data) ?? {}
    const album = mapValue(song['album'])
    const artists = listValue(song['artists']) ?? []
    const artistNames = artists
      .map((artist) => mapValue(artist)?.['name']?.toString())
      .filter((name): name is string => name != null && name !== '')
      .join(' / ')

    return {
      id: song['id']?.toString() ?? '',
      source: song['provider']?.toString() ?? DefaultMusicProvider.defaultSource,
      title: song['title']?.toString() ?? '未知歌曲',
      artist:
        artistNames === ''
          ? song['artist']?.toString() ?? '未知艺人'
          : artistNames,
      album:
        album?.['name']?.toString() ??
        album?.['title']?.toString() ??
        song['album']?.toString() ??
        '',
      duration: song['duration'] ?? song['durationSeconds'] ?? 0,
      coverUrl:
        song['cover']?.toString() ??
        album?.['picUrl']?.toString() ??
        album?.['cover']?.toString() ??
        '',
      lyrics: song['lyrics']?.toString() ?? song['lyric']?.toString() ?? '',
    }
  }

  private static parsePlaylist(data: unknown): RawSong {
    const playlist = mapValue(data) ?? {}
    const creator = mapValue(playlist['creator'])
    const songs = listValue(playlist['songs']) ?? []
    const songCount = intValue(playlist['songCount'])
    const playCount = intValue(playlist['playCount'])
    const creatorName = creator?.['nickname']?.toString() ?? ''
    const detailParts = [
      songCount > 0 ? `${songCount} 首歌曲` : '',
      playCount > 0 ? `${compactCount(playCount)} 次播放` : '',
      creatorName,
    ].filter((part) => part !== '')

    return {
      id: playlist['id']?.toString() ?? '',
      source:
        playlist['provider']?.toString() ?? DefaultMusicProvider.defaultSource,
      title:
        playlist['title']?.toString() ??
        playlist['name']?.toString() ??
        '未知歌单',
      subtitle: detailParts.join(' • '),
      coverUrl:
        playlist['cover']?.toString() ??
        playlist['picUrl']?.toString() ??
        playlist['coverUrl']?.toString() ??
        '',
      songCount,
      playCount,
      songs: songs
        .filter((item) => mapValue(item) != null)
        .map((item) => DefaultMusicProvider.parseSong(item)),
    }
  }

  private static parsePlayUrl(json: Record<string, unknown>): string {
    const data = mapValue(json['data'])
    const audio = mapValue(data?.['audio'])
    const url = audio?.['url']?.toString()
    if (url == null || url === '') {
      throw new Error(json['message']?.toString() ?? '未获取到播放地址')
    }
    return url
  }
}

function compactCount(value: number): string {
  if (value >= 10000) {
    const count = value / 10000
    const text =
      count >= 100 ? String(Math.round(count)) : count.toFixed(1)
    return `${text.replace(/\.0$/, '')}万`
  }
  return String(value)
}
