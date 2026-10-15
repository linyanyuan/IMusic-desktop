/**
 * GDStudio 薄客户端 —— 移植自 lib/services/gdstudio_music_client.dart。
 *
 * 桌面端「单曲」搜索 tab 的首选路径；不稳定的源/空播放地址由
 * Hybrid + Bilibili 兜底。HTTP 用全局 fetch + AbortController 实现超时。
 */

import type { RawSong } from './musicProvider'
import type { PlaybackUrl } from './models'
import { playbackUrl } from './models'

const DEFAULT_HEADERS: Record<string, string> = {
  // 浏览器会静默丢弃 User-Agent（forbidden header），Node/undici 下生效
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json, text/javascript, */*; q=0.01',
}

/**
 * GET JSON，整体超时 timeoutMs（Dio 的 connect/receive timeout 合并语义）。
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export interface GdStudioMusicClientOptions {
  baseUrl?: string
  sources?: string[]
  /** 单次源搜索整体超时，默认 8000ms */
  searchTimeoutMs?: number
  /** 每源 count 查询参数，默认 20 */
  countPerSource?: number
}

export class GdStudioMusicClient {
  static readonly defaultBaseUrl = 'https://music-api.gdstudio.xyz/api.php'

  /**
   * 第一页顺序。
   *
   * 2026-10 上游回归：joox 的 `types=url` 已恒返回空地址（`{"url":"","br":-1}`），
   * kuwo/tencent/kugou/migu/spotify/deezer 一律 HTTP 400 `Value of \`source\` is not supported`。
   * 目前只有 netease 的 search/url/lyric 均可用，故退化为单源；netease 失效时由
   * Hybrid 的 Bilibili 兜底。
   */
  static readonly defaultSources = ['netease']

  /** 支持 pages/count 做 load-more 的源（netease 实测第 2/3 页返回不同结果） */
  static readonly pageableSources = ['netease']

  static readonly defaultCountPerSource = 20

  static readonly idPrefix = 'gdstudio:'

  /** 单次 url/bitrate 探测上限，慢的源不能拖死播放 */
  static readonly urlAttemptTimeoutMs = 5000

  /** Dio receiveTimeout 的等价物（普通请求整体超时） */
  static readonly defaultRequestTimeoutMs = 12000

  private readonly baseUrl: string
  private readonly sources: string[]
  private readonly searchTimeoutMs: number
  private readonly countPerSource: number

  /** 同一 query 多页搜索的粘性源 */
  private stickySource: string | null = null
  private stickyQuery: string | null = null

  constructor(opts: GdStudioMusicClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? GdStudioMusicClient.defaultBaseUrl
    this.sources = opts.sources ?? [...GdStudioMusicClient.defaultSources]
    this.searchTimeoutMs = opts.searchTimeoutMs ?? 8000
    this.countPerSource = opts.countPerSource ?? GdStudioMusicClient.defaultCountPerSource
  }

  /** `gdstudio:{source}:{urlId}` → [source, urlId] */
  /**
   * 只接受 `gdstudio:{source}:{id}`；早期无 source 的 `gdstudio:{id}` 形态在 Dart 端
   * 同样被拒（两端行为一致，不为兼容旧 id 单方面放宽）。
   */
  static parseSongId(id: string): [string, string] | null {
    if (!id.startsWith(GdStudioMusicClient.idPrefix)) return null
    const rest = id.substring(GdStudioMusicClient.idPrefix.length)
    const sep = rest.indexOf(':')
    if (sep <= 0 || sep >= rest.length - 1) return null
    return [rest.substring(0, sep), rest.substring(sep + 1)]
  }

  static buildSongId(opts: { source: string; mediaId: string }): string {
    return `${GdStudioMusicClient.idPrefix}${opts.source}:${opts.mediaId}`
  }

  static isGdStudioId(id: string): boolean {
    return id.startsWith(GdStudioMusicClient.idPrefix)
  }

  /**
   * 搜索首选源。
   *
   * 2026-10 上游回归：music-api.gdstudio.xyz 只剩 netease 源可用（joox 的
   * `types=url` 恒返回空地址，kuwo/tencent/kugou/migu/spotify/deezer 一律
   * HTTP 400 `Value of source is not supported`），所以 defaultSources 已收敛为
   * `['netease']`；netease 也失败时由 HybridMusicProvider 回退 B 站。
   *
   * 不要再照抄 `['joox','kuwo','netease']` 这类旧顺序 —— 那会让搜索结果全是
   * joox 条目、取链为空，表现为「播控栏有歌名但不出声」。
   *
   * Page 1+: 逐个源取第一页非空结果；第 2 页起的 load-more 由可分页源承担。
   */
  async searchSongs(query: string, page = 1): Promise<RawSong[]> {
    const q = query.trim()
    if (q === '') return []
    const safePage = page < 1 ? 1 : page

    if (safePage <= 1) {
      for (const source of this.sources) {
        try {
          const rows = await this.searchSource(source, q, 1, this.searchTimeoutMs)
          if (rows.length > 0) {
            this.stickySource = source
            this.stickyQuery = q
            return rows
          }
        } catch (e) {
          console.log(`[GdStudio] search source=${source} page=1 failed: ${e}`)
        }
      }
      return []
    }

    const pageTarget = this.pageTargetFor(q, safePage)
    for (const source of pageTarget.sources) {
      try {
        const rows = await this.searchSource(
          source,
          q,
          pageTarget.sourcePage,
          this.searchTimeoutMs,
        )
        if (rows.length > 0) {
          this.stickySource = source
          this.stickyQuery = q
          return rows
        }
      } catch (e) {
        console.log(
          `[GdStudio] search source=${source} page=${pageTarget.sourcePage} failed: ${e}`,
        )
      }
    }
    return []
  }

  private pageTargetFor(
    query: string,
    page: number,
  ): { sources: string[]; sourcePage: number } {
    const sticky =
      this.stickyQuery === query && this.stickySource != null
        ? this.stickySource
        : null
    const pageableInConfig = this.sources.filter((s) =>
      GdStudioMusicClient.pageableSources.includes(s),
    )
    const fallbackPageable =
      pageableInConfig.length > 0
        ? pageableInConfig
        : GdStudioMusicClient.pageableSources

    if (sticky != null && GdStudioMusicClient.pageableSources.includes(sticky)) {
      return {
        sources: [sticky, ...fallbackPageable.filter((s) => s !== sticky)],
        sourcePage: page,
      }
    }

    // 不可分页源先命中（如 joox）：第一次 load-more → 可分页源第 1 页
    const sourcePage = page - 1 < 1 ? 1 : page - 1
    return { sources: fallbackPageable, sourcePage }
  }

  private async searchSource(
    source: string,
    query: string,
    page: number,
    timeoutMs: number,
  ): Promise<RawSong[]> {
    const params = new URLSearchParams({
      types: 'search',
      source,
      name: query,
      count: String(this.countPerSource),
      pages: String(page < 1 ? 1 : page),
    })
    const data = await fetchJson(
      `${this.baseUrl}?${params.toString()}`,
      timeoutMs,
      DEFAULT_HEADERS,
    )
    if (!Array.isArray(data)) return []

    const songs: RawSong[] = []
    const seen = new Set<string>()
    for (const item of data) {
      if (!isRecord(item)) continue
      const mapped = GdStudioMusicClient.mapSearchItem(item)
      if (mapped == null) continue
      const id = mapped['id']?.toString() ?? ''
      if (id === '' || seen.has(id)) continue
      seen.add(id)
      songs.push(mapped)
    }
    return this.attachCoverUrls(songs)
  }

  /** 通过 CDN hint 或 types=pic 补齐缺失封面（并发，单项 3s 上限） */
  private async attachCoverUrls(songs: RawSong[]): Promise<RawSong[]> {
    if (songs.length === 0) return songs
    return Promise.all(
      songs.map(async (song) => {
        const existing = song['coverUrl']?.toString().trim() ?? ''
        if (existing !== '') return song
        const source = song['gdstudioSource']?.toString() ?? ''
        const picId = song['pic_id']?.toString() ?? ''
        if (source === '' || picId === '') return song

        const hinted = GdStudioMusicClient.coverUrlHint({ source, picId })
        if (hinted != null) {
          return { ...song, coverUrl: hinted }
        }

        try {
          const url = await this.getPicUrl({ source, picId, size: 300 }, 3000)
          if (url != null && url !== '') {
            return { ...song, coverUrl: url }
          }
        } catch {
          /* ignore */
        }
        return song
      }),
    )
  }

  /** API 搜索行 → app 歌曲 map。不可用返回 null。 */
  static mapSearchItem(raw: Record<string, unknown>): RawSong | null {
    const source = raw['source']?.toString().trim() ?? ''
    const urlIdValue = raw['url_id'] ?? raw['id']
    const urlId = urlIdValue?.toString().trim() ?? ''
    const name = raw['name']?.toString().trim() ?? ''
    if (source === '' || urlId === '' || name === '') return null

    const artist = artistText(raw['artist'])
    const album = raw['album']?.toString() ?? ''
    const lyricIdValue = raw['lyric_id']
    const lyricId = lyricIdValue != null ? lyricIdValue.toString() : urlId
    const picId = raw['pic_id']?.toString() ?? ''
    const id = GdStudioMusicClient.buildSongId({ source, mediaId: urlId })
    const durationMs = durationMsFromSearchRow(raw)
    const coverHint = GdStudioMusicClient.coverUrlHint({ source, picId })

    return {
      id,
      title: name,
      artist,
      album,
      resultType: 'song',
      source,
      sourceLabel: `GDStudio · ${source}`,
      metaSource: 'GDStudio',
      playbackSource: source,
      gdstudioSource: source,
      url_id: urlId,
      lyric_id: lyricId,
      pic_id: picId,
      ...(coverHint != null ? { coverUrl: coverHint } : {}),
      ...(durationMs > 0 ? { duration: durationMs } : {}),
      // 优先走 UrlSource 流播（通常无需自定义 header）
      preferDirectUrl: true,
    }
  }

  /** 不发 HTTP 的尽力封面（源专属 CDN）。 */
  static coverUrlHint(opts: { source: string; picId: string }): string | null {
    const id = opts.picId.trim()
    if (id === '') return null
    if (id.startsWith('http://') || id.startsWith('https://')) return id

    switch (opts.source) {
      case 'joox':
        return `https://image.joox.com/JOOXcover/0/${id}/300`
      case 'kuwo':
        // pic_id 常形如 "120/79/49/xxx.jpg"
        return `https://img1.kwcdn.kuwo.cn/star/albumcover/${id}`
      case 'bilibili':
        return id.startsWith('//') ? `https:${id}` : null
      default:
        return null
    }
  }

  /**
   * 解析 `gdstudio:` 歌曲 id 的可播放地址。
   *
   * 歌词不在此获取（由 Hybrid.getLyrics 异步获取），拿到流地址即可开播。
   */
  async getPlayUrl(songId: string): Promise<PlaybackUrl> {
    const parsed = GdStudioMusicClient.parseSongId(songId)
    if (parsed == null) {
      throw new Error(`invalid gdstudio id: ${songId}`)
    }
    const [source, mediaId] = parsed

    let url: string | null = null
    // 中等码率优先 —— 常比先探 320 失败再回落更快成功
    for (const br of [192, 128, 320, 999]) {
      try {
        const hit = await this.fetchUrl(
          source,
          mediaId,
          br,
          GdStudioMusicClient.urlAttemptTimeoutMs,
        )
        if (hit != null && hit !== '') {
          url = hit
          break
        }
      } catch (e) {
        console.log(`[GdStudio] url br=${br} failed: ${e}`)
      }
    }
    if (url == null || url === '') {
      throw new Error(`GDStudio 未返回播放地址 (${source}:${mediaId})`)
    }

    // 相对路径少见；必要时补全
    const absolute = url.startsWith('http')
      ? url
      : `https://music.gdstudio.xyz/${url.replace(/^\//, '')}`

    return playbackUrl(absolute, { resolvedId: songId })
  }

  private async fetchUrl(
    source: string,
    mediaId: string,
    br: number,
    timeoutMs: number,
  ): Promise<string | null> {
    const params = new URLSearchParams({
      types: 'url',
      source,
      id: mediaId,
      br: String(br),
    })
    const data = await fetchJson(
      `${this.baseUrl}?${params.toString()}`,
      timeoutMs,
      DEFAULT_HEADERS,
    )
    if (!isRecord(data)) return null
    const url = data['url']?.toString().trim() ?? ''
    const brField = data['br']
    if (url === '') return null
    if (brField === -1 || brField === '-1') return null
    return url
  }

  async getLyric(opts: { source: string; lyricId: string }): Promise<string> {
    const params = new URLSearchParams({
      types: 'lyric',
      source: opts.source,
      id: opts.lyricId,
    })
    const data = await fetchJson(
      `${this.baseUrl}?${params.toString()}`,
      GdStudioMusicClient.defaultRequestTimeoutMs,
      DEFAULT_HEADERS,
    )
    if (!isRecord(data)) return ''
    const lyric = data['lyric']?.toString().trim() ?? ''
    if (
      lyric === '' ||
      lyric === 'NULL' ||
      lyric === 'null' ||
      lyric.includes('歌词获取失败')
    ) {
      return ''
    }
    return lyric
  }

  /** `types=pic` → `{ "url": "https://..." }` */
  async getPicUrl(
    opts: { source: string; picId: string; size?: number },
    timeoutMs: number = GdStudioMusicClient.defaultRequestTimeoutMs,
  ): Promise<string | null> {
    const id = opts.picId.trim()
    if (opts.source.trim() === '' || id === '') return null
    const params = new URLSearchParams({
      types: 'pic',
      source: opts.source,
      id,
      size: String(opts.size ?? 300),
    })
    const data = await fetchJson(
      `${this.baseUrl}?${params.toString()}`,
      timeoutMs,
      DEFAULT_HEADERS,
    )
    if (!isRecord(data)) return null
    const url = data['url']?.toString().trim() ?? ''
    if (url === '') return null
    if (url.startsWith('//')) return `https:${url}`
    return url
  }
}

// ================= 静态工具（对应 Dart 私有静态方法） =================

/** 搜索行很少带时长；尽量读常见可选字段 */
function durationMsFromSearchRow(raw: Record<string, unknown>): number {
  const extra = raw['extra_data']
  const candidates: unknown[] = [
    raw['duration'],
    raw['dt'],
    raw['time'],
    isRecord(extra) ? extra['duration'] : undefined,
    isRecord(extra) ? extra['dt'] : undefined,
  ]
  for (const value of candidates) {
    const ms = coerceDurationMs(value)
    if (ms > 0) return ms
  }
  return 0
}

function coerceDurationMs(value: unknown): number {
  if (value == null) return 0
  if (typeof value === 'number') {
    // 启发式：小于 10000 的值按秒处理
    const n = Math.round(value)
    return n > 10000 ? n : n * 1000
  }
  const text = value.toString().trim()
  if (text === '') return 0
  // Dart int.tryParse：仅接受可选符号 + 纯数字
  if (/^[+-]?\d+$/.test(text)) {
    const asInt = Number.parseInt(text, 10)
    return asInt > 10000 ? asInt : asInt * 1000
  }
  const parts = text.split(':')
  if (parts.length === 2) {
    const m = Number.parseInt(parts[0], 10) || 0
    const s = Number.parseInt(parts[1], 10) || 0
    return (m * 60 + s) * 1000
  }
  if (parts.length === 3) {
    const h = Number.parseInt(parts[0], 10) || 0
    const m = Number.parseInt(parts[1], 10) || 0
    const s = Number.parseInt(parts[2], 10) || 0
    return (h * 3600 + m * 60 + s) * 1000
  }
  return 0
}

function artistText(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw
      .map((e) => e?.toString().trim() ?? '')
      .filter((e) => e !== '')
      .join(' / ')
  }
  return raw?.toString().trim() ?? ''
}
