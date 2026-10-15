/**
 * 网易云公开接口客户端 —— 分类歌单 / 歌单详情 / 分类热门单曲。
 *
 * 只依赖 music.163.com 的免鉴权 web api：
 *   - 分类歌单列表 `/api/playlist/list?cat=&order=hot&limit=&offset=`
 *   - 分类目录     `/api/playlist/catalogue`（核对分类名是否真实存在）
 *   - 歌单详情     `/api/v6/playlist/detail?id=&n=1000`
 *   - 歌曲详情补全 `/api/v3/song/detail?c=[{"id":...}]`
 *
 * 未登录时 `playlist/detail` 只回传前 10 首 tracks，完整列表在 trackIds 里，
 * 因此 tracks 不足时按 trackIds 顺序用 song/detail 分批补齐（单批 ≤200，总量 ≤300）。
 *
 * 歌曲记录刻意映射成与 GdStudioMusicClient.mapSearchItem 相同的形状
 * （id = `gdstudio:netease:<mediaId>`），这样 HybridMusicProvider 现有的
 * GDStudio 取链/歌词分支与 songCache 直接可用 —— 无需为网易源新增播放/歌词通路。
 */

import type { RawSong } from './musicProvider'
import { GdStudioMusicClient } from './gdstudio'

const API_BASE = 'https://music.163.com'

/**
 * 163 的公开接口对 Referer 有校验。Electron 主进程会为 *.163.com 注入
 * （electron/headers.ts），但单元测试与 qa 探针走裸 Node fetch，所以这里显式带上。
 */
const DEFAULT_HEADERS: Record<string, string> = {
  Referer: 'https://music.163.com',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
}

export const NETEASE_PLAYLIST_PREFIX = 'netease-playlist:'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000
/** song/detail 单批上限（接口本身建议 ≤200） */
const SONG_DETAIL_BATCH_SIZE = 200
/** 单个歌单最多解析多少首（够用即可，避免拉满几千首把首屏拖死） */
const MAX_PLAYLIST_SONGS = 300
/** 分类「热门单曲」目标首数 */
const CATEGORY_SONGS_TARGET = 30
/** 分类「热门单曲」每批取几个歌单做来源 */
const CATEGORY_PLAYLISTS_PER_PAGE = 3

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string {
  return value == null ? '' : String(value)
}

/** 网易图床会回 http://，渲染层 CSP 只放 https（http 图会被拒 → 封面全空） */
function httpToHttps(url: string): string {
  const text = url.trim()
  if (text.startsWith('//')) return `https:${text}`
  if (text.startsWith('http://')) return `https://${text.slice('http://'.length)}`
  return text
}

/** `[{name:'a'},{name:'b'}]` → `'a / b'`（与 GDStudio 的 artist 连接方式一致） */
function artistText(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (isRecord(entry) ? asString(entry['name']).trim() : asString(entry).trim()))
      .filter((name) => name !== '')
      .join(' / ')
  }
  return asString(raw).trim()
}

/**
 * 轮询交错合并多组歌曲并按 id、标题+歌手去重，最多取 limit 首。
 *
 * 「分类热门单曲」= 该分类下几个热门歌单的曲目交错 —— 直接串接会让列表前 30 首
 * 全来自同一个歌单，交错后风格更杂、更像「分类热门」。
 */
export function interleaveSongs(lists: RawSong[][], limit: number): RawSong[] {
  const result: RawSong[] = []
  const seenIds = new Set<string>()
  const seenTitles = new Set<string>()
  const rounds = lists.reduce((max, list) => Math.max(max, list.length), 0)

  const push = (song: RawSong) => {
    if (result.length >= limit) return
    const id = asString(song['id']).trim()
    const titleKey = `${asString(song['title']).trim().toLowerCase()}|${asString(
      song['artist'],
    )
      .trim()
      .toLowerCase()}`
    if (id !== '' && seenIds.has(id)) return
    if (titleKey !== '|' && seenTitles.has(titleKey)) return
    if (id !== '') seenIds.add(id)
    if (titleKey !== '|') seenTitles.add(titleKey)
    result.push(song)
  }

  for (let i = 0; i < rounds; i++) {
    for (const list of lists) {
      if (i < list.length) push(list[i])
      if (result.length >= limit) return result
    }
  }
  return result
}

/** 轻度打散：相邻两两换位（不引入随机数，便于测试与「换一批」可复现） */
export function lightShuffle(songs: RawSong[]): RawSong[] {
  const result = [...songs]
  for (let i = 0; i + 1 < result.length; i += 2) {
    const tmp = result[i]
    result[i] = result[i + 1]
    result[i + 1] = tmp
  }
  return result
}

export interface NeteasePublicClientOptions {
  fetchImpl?: typeof fetch
  /** 单次请求整体超时，默认 10s */
  timeoutMs?: number
  /** 内存缓存 TTL，默认 30 分钟 */
  cacheTtlMs?: number
  /** 时间源，便于测试 TTL */
  now?: () => number
}

export interface CategoryPlaylistOptions {
  limit?: number
  offset?: number
}

export class NeteasePublicClient {
  static readonly playlistPrefix = NETEASE_PLAYLIST_PREFIX

  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly cacheTtlMs: number
  private readonly now: () => number

  /** 分类歌单列表 & 歌单详情的内存缓存（TTL 见 cacheTtlMs） */
  private readonly cache = new Map<string, { at: number; value: unknown }>()

  constructor(opts: NeteasePublicClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args))
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    this.now = opts.now ?? (() => Date.now())
  }

  static buildPlaylistId(rawId: string | number): string {
    return `${NETEASE_PLAYLIST_PREFIX}${rawId}`
  }

  static isNeteasePlaylistId(id: string): boolean {
    return id.startsWith(NETEASE_PLAYLIST_PREFIX)
  }

  /** `netease-playlist:123` → `123`；非法返回 '' */
  static rawPlaylistId(id: string): string {
    if (!NeteasePublicClient.isNeteasePlaylistId(id)) return ''
    return id.slice(NETEASE_PLAYLIST_PREFIX.length).trim()
  }

  /** 曲目行 → app 歌曲 map；不可用返回 null（与 GdStudio.mapSearchItem 同形状） */
  static mapSong(raw: Record<string, unknown>): RawSong | null {
    const mediaId = asString(raw['id']).trim()
    const name = asString(raw['name']).trim()
    if (mediaId === '' || name === '') return null

    const album = isRecord(raw['al']) ? asString(raw['al']['name']) : ''
    const picUrl = isRecord(raw['al']) ? httpToHttps(asString(raw['al']['picUrl'])) : ''
    const artist = artistText(raw['ar'])
    const durationValue = raw['dt'] ?? raw['duration']
    const duration = Number(durationValue)
    const id = GdStudioMusicClient.buildSongId({ source: 'netease', mediaId })

    return {
      id,
      title: name,
      artist,
      album,
      resultType: 'song',
      source: 'netease',
      sourceLabel: '网易云',
      metaSource: 'GDStudio',
      playbackSource: 'netease',
      gdstudioSource: 'netease',
      url_id: mediaId,
      lyric_id: mediaId,
      ...(picUrl !== '' ? { pic_id: picUrl, coverUrl: picUrl } : {}),
      ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
      // 网易云走 GDStudio 的 netease 源直链（无需自定义 header），优先流播
      preferDirectUrl: true,
    }
  }

  /** 分类歌单列表行 → app 歌单 map（resultType='playlist'） */
  static mapPlaylistRow(raw: Record<string, unknown>): RawSong | null {
    const rawId = asString(raw['id']).trim()
    const name = asString(raw['name']).trim()
    if (rawId === '' || name === '') return null

    const creator = isRecord(raw['creator']) ? asString(raw['creator']['nickname']).trim() : ''
    const cover = httpToHttps(asString(raw['coverImgUrl']))
    const songCount = Number(raw['trackCount'])
    const playCount = Number(raw['playCount'])

    return {
      id: NeteasePublicClient.buildPlaylistId(rawId),
      title: name,
      subtitle: creator,
      artist: creator,
      resultType: 'playlist',
      source: 'netease',
      sourceLabel: '网易云',
      ...(cover !== '' ? { coverUrl: cover } : {}),
      songCount: Number.isFinite(songCount) && songCount > 0 ? songCount : 0,
      ...(Number.isFinite(playCount) && playCount > 0 ? { playCount } : {}),
    }
  }

  /** 分类热门歌单列表 */
  async getCategoryPlaylists(
    cat: string,
    opts: CategoryPlaylistOptions = {},
  ): Promise<RawSong[]> {
    const category = cat.trim()
    if (category === '') return []
    const limit = Math.max(1, Math.floor(opts.limit ?? 20))
    const offset = Math.max(0, Math.floor(opts.offset ?? 0))
    const cacheKey = `list:${category}:${limit}:${offset}`

    const cached = this.readCache<RawSong[]>(cacheKey)
    if (cached != null) return cached

    const url = `${API_BASE}/api/playlist/list?cat=${encodeURIComponent(
      category,
    )}&order=hot&limit=${limit}&offset=${offset}`
    const json = await this.fetchJson(url)
    const rows = Array.isArray(json['playlists']) ? json['playlists'] : []
    const mapped = rows
      .filter(isRecord)
      .map((row) => NeteasePublicClient.mapPlaylistRow(row))
      .filter((row): row is RawSong => row != null)

    this.writeCache(cacheKey, mapped)
    return mapped
  }

  /** 歌单详情：标题 + 封面 + 完整曲目（tracks 不足时用 song/detail 补全） */
  async getPlaylist(id: string, limit?: number): Promise<RawSong> {
    const rawId = NeteasePublicClient.rawPlaylistId(id)
    if (rawId === '') throw new Error(`非法网易云歌单 id: ${id}`)

    const cacheKey = `detail:${rawId}`
    let detail = this.readCache<RawSong>(cacheKey)
    if (detail == null) {
      detail = await this.loadPlaylistDetail(rawId)
      this.writeCache(cacheKey, detail)
    }
    if (limit != null && limit > 0 && Array.isArray(detail['songs'])) {
      return { ...detail, songs: (detail['songs'] as RawSong[]).slice(0, limit) }
    }
    return detail
  }

  /**
   * 分类「热门单曲」：取该分类第 page 批热门歌单（每批 3 个）→ 拉详情 →
   * 轮询交错合并、按 id 与「标题+歌手」去重，返回最多 30 首。
   */
  async getCategorySongs(cat: string, page = 1): Promise<RawSong[]> {
    const category = cat.trim()
    if (category === '') return []
    const safePage = Math.max(1, Math.floor(page))
    const offset = (safePage - 1) * CATEGORY_PLAYLISTS_PER_PAGE

    const playlists = await this.getCategoryPlaylists(category, {
      limit: CATEGORY_PLAYLISTS_PER_PAGE,
      offset,
    })
    if (playlists.length === 0) return []

    const details = await Promise.all(
      playlists.map((playlist) =>
        this.getPlaylist(asString(playlist['id'])).catch(() => null),
      ),
    )
    const lists = details
      .filter((detail): detail is RawSong => detail != null)
      .map((detail) => (Array.isArray(detail['songs']) ? (detail['songs'] as RawSong[]) : []))
      .filter((songs) => songs.length > 0)

    return lightShuffle(interleaveSongs(lists, CATEGORY_SONGS_TARGET))
  }

  // ---------- 内部实现 ----------

  private async loadPlaylistDetail(rawId: string): Promise<RawSong> {
    const json = await this.fetchJson(
      `${API_BASE}/api/v6/playlist/detail?id=${encodeURIComponent(rawId)}&n=1000`,
    )
    const playlist = isRecord(json['playlist']) ? json['playlist'] : null
    if (playlist == null) throw new Error(`网易云歌单不存在: ${rawId}`)

    const tracks = Array.isArray(playlist['tracks'])
      ? playlist['tracks'].filter(isRecord)
      : []
    const trackIds = Array.isArray(playlist['trackIds'])
      ? playlist['trackIds'].filter(isRecord)
      : []
    const byId = new Map<string, Record<string, unknown>>()
    for (const track of tracks) {
      const trackId = asString(track['id']).trim()
      if (trackId !== '') byId.set(trackId, track)
    }

    const orderedIds = trackIds
      .map((entry) => asString(entry['id']).trim())
      .filter((entry) => entry !== '')
    const ids = (orderedIds.length > 0 ? orderedIds : [...byId.keys()]).slice(
      0,
      MAX_PLAYLIST_SONGS,
    )

    // 未登录时 detail 只给前 10 首 tracks，其余按 trackIds 顺序分批补全
    const missing = ids.filter((songId) => !byId.has(songId))
    for (let i = 0; i < missing.length; i += SONG_DETAIL_BATCH_SIZE) {
      const batch = missing.slice(i, i + SONG_DETAIL_BATCH_SIZE)
      try {
        const rows = await this.fetchSongDetails(batch)
        for (const row of rows) {
          const rowId = asString(row['id']).trim()
          if (rowId !== '') byId.set(rowId, row)
        }
      } catch (e) {
        console.log(`[Netease] song/detail 补全失败（${batch.length} 首）: ${e}`)
      }
    }

    const songs: RawSong[] = []
    for (const songId of ids) {
      const row = byId.get(songId)
      if (row == null) continue
      const mapped = NeteasePublicClient.mapSong(row)
      if (mapped != null) songs.push(mapped)
    }
    // 极端情况（trackIds 全为 null 等）退化用 tracks 自身
    if (songs.length === 0) {
      for (const track of tracks) {
        const mapped = NeteasePublicClient.mapSong(track)
        if (mapped != null) songs.push(mapped)
      }
    }

    const creator = isRecord(playlist['creator'])
      ? asString(playlist['creator']['nickname']).trim()
      : ''
    const cover = httpToHttps(asString(playlist['coverImgUrl']))
    const playCount = Number(playlist['playCount'])

    return {
      id: NeteasePublicClient.buildPlaylistId(rawId),
      title: asString(playlist['name']).trim() || '网易云歌单',
      subtitle: creator,
      artist: creator,
      resultType: 'playlist',
      source: 'netease',
      sourceLabel: '网易云',
      ...(cover !== '' ? { coverUrl: cover } : {}),
      songCount: ids.length > 0 ? ids.length : songs.length,
      ...(Number.isFinite(playCount) && playCount > 0 ? { playCount } : {}),
      songs,
    }
  }

  private async fetchSongDetails(ids: string[]): Promise<Record<string, unknown>[]> {
    const payload = ids.map((id) => {
      const numeric = Number(id)
      return { id: Number.isFinite(numeric) && String(numeric) === id ? numeric : id }
    })
    const url = `${API_BASE}/api/v3/song/detail?c=${encodeURIComponent(JSON.stringify(payload))}`
    const json = await this.fetchJson(url)
    const songs = Array.isArray(json['songs']) ? json['songs'] : []
    return songs.filter(isRecord)
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(url, {
        headers: DEFAULT_HEADERS,
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
      const json: unknown = await response.json()
      if (!isRecord(json)) throw new Error(`网易云接口返回非对象: ${url}`)
      return json
    } finally {
      clearTimeout(timer)
    }
  }

  private readCache<T>(key: string): T | null {
    const entry = this.cache.get(key)
    if (entry == null) return null
    if (this.now() - entry.at > this.cacheTtlMs) {
      this.cache.delete(key)
      return null
    }
    return entry.value as T
  }

  private writeCache(key: string, value: unknown): void {
    this.cache.set(key, { at: this.now(), value })
  }
}
