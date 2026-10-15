/**
 * ChKSz 网易云客户端 + Provider —— 移植自
 * lib/services/chksz_music_client.dart 与 lib/services/chksz_music_provider.dart。
 *
 * ID 约定（必须与移动端一致，保证同步的收藏/歌单解析到同一来源）：
 *   单曲: `chksz:163:{neteaseSongId}`
 *   歌单: `chksz:playlist:{neteasePlaylistId}`
 *
 * Key 解析优先级：运行时 provider（设置页） > 环境变量 CHKSZ_API_KEY。
 */

import type { MusicProvider, RawSong } from './musicProvider'
import type { PlaybackUrl } from './models'
import { playbackUrl } from './models'

/** 未配置 ChKSz API key 时抛出；UI 提示去设置页填写，播放绝不能回退 B 站（配置错误而非源故障） */
export class ChkszApiKeyMissingError extends Error {
  constructor(message = '未配置 ChKSz API 密钥，请在设置中填写') {
    super(message)
    this.name = 'ChkszApiKeyMissingError'
  }
}

/** ChKSz 业务错误（HTTP 200 但 `code != 200`）或 HTTP 层错误 */
export class ChkszApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChkszApiError'
  }
}

export type ChkszApiKeyProvider = () => string

export interface ChkszMusicClientOptions {
  baseUrl?: string
  /** 运行时 key provider（应用设置）；未配置时返回空串 */
  apiKeyProvider?: ChkszApiKeyProvider
  /** 静态 key（等价于传入返回该值的 provider） */
  apiKey?: string
  /** 搜索整体超时，毫秒；默认 12s */
  searchTimeout?: number
}

interface UrlHit {
  url: string
  picUrl: string
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json, text/javascript, */*; q=0.01',
}

/** 编译期/环境注入的 key（Electron 下读 process.env.CHKSZ_API_KEY）；仓库内不硬编码 */
function envKey(): string {
  const proc = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process
  return proc?.env?.['CHKSZ_API_KEY'] ?? ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * ChKSz 网易云 API（https://api.chksz.com）薄客户端。
 * HTTP 用全局 fetch + AbortController 超时（对应 Dart dio 的 connect/receive timeout
 * 及 `.timeout()` 包装）。
 */
export class ChkszMusicClient {
  static readonly defaultBaseUrl = 'https://api.chksz.com'
  static readonly idPrefix = 'chksz:'
  static readonly songIdPrefix = 'chksz:163:'
  static readonly playlistIdPrefix = 'chksz:playlist:'

  /** 环境注入 key（`CHKSZ_API_KEY`）；仓库内不硬编码 */
  static readonly envApiKey: string = envKey()

  /** 音质阶梯：优先 exhigh，降级 standard */
  static readonly qualityLadder: readonly string[] = ['exhigh', 'standard']

  /** 单次取链探测上限，慢源不能拖死播放（毫秒） */
  static readonly urlAttemptTimeout = 5000

  /** B 站回退整体预算（与移动端一致，~12s，毫秒） */
  static readonly fallbackTimeout = 12000

  /** searchSongs 页大小；与搜索 UI 的每页提示对齐，保证 load-more 分页对齐 */
  static readonly searchPageSize = 20

  /** dio receiveTimeout 等价物：非搜索请求的默认超时（毫秒） */
  static readonly defaultRequestTimeout = 15000

  readonly baseUrl: string
  readonly searchTimeout: number
  private readonly apiKeyProvider: ChkszApiKeyProvider

  constructor(options: ChkszMusicClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? ChkszMusicClient.defaultBaseUrl
    this.apiKeyProvider =
      options.apiKeyProvider ?? (() => options.apiKey ?? ChkszMusicClient.envApiKey)
    this.searchTimeout = options.searchTimeout ?? 12000
  }

  /** 运行时设置优先于环境注入 */
  private get apiKey(): string {
    const configured = this.apiKeyProvider().trim()
    if (configured !== '') return configured
    return ChkszMusicClient.envApiKey
  }

  // === ID helpers（必须与移动端约定一致） ===

  static isChkszId(id: string): boolean {
    return id.startsWith(ChkszMusicClient.idPrefix)
  }

  static isChkszSongId(id: string): boolean {
    return id.startsWith(ChkszMusicClient.songIdPrefix)
  }

  static isChkszPlaylistId(id: string): boolean {
    return id.startsWith(ChkszMusicClient.playlistIdPrefix)
  }

  static buildSongId(neteaseId: string): string {
    return `${ChkszMusicClient.songIdPrefix}${neteaseId}`
  }

  static buildPlaylistId(neteaseId: string): string {
    return `${ChkszMusicClient.playlistIdPrefix}${neteaseId}`
  }

  /** `chksz:163:{id}` → `{id}`；其他形式返回 null */
  static parseSongId(id: string): string | null {
    if (!id.startsWith(ChkszMusicClient.songIdPrefix)) return null
    const rest = id.substring(ChkszMusicClient.songIdPrefix.length)
    return rest === '' ? null : rest
  }

  /** `chksz:playlist:{id}` → `{id}`；其他形式返回 null */
  static parsePlaylistId(id: string): string | null {
    if (!id.startsWith(ChkszMusicClient.playlistIdPrefix)) return null
    const rest = id.substring(ChkszMusicClient.playlistIdPrefix.length)
    return rest === '' ? null : rest
  }

  // === 搜索 ===

  /**
   * 搜索网易云单曲，offset 分页（`offset = (page - 1) * searchPageSize`）。
   * 结果按 id 去重。
   */
  async searchSongs(query: string, page = 1): Promise<RawSong[]> {
    const q = query.trim()
    if (q === '') return []
    const safePage = page < 1 ? 1 : page
    const data = await this.getJson(
      '/api/163_search',
      {
        keyword: q,
        limit: ChkszMusicClient.searchPageSize,
        ...(safePage > 1
          ? { offset: (safePage - 1) * ChkszMusicClient.searchPageSize }
          : {}),
      },
      this.searchTimeout,
    )

    const songs = this.extractSongs(data)
    const seen = new Set<string>()
    const results: RawSong[] = []
    for (const song of songs) {
      const id = song['id']?.toString() ?? ''
      if (id === '' || seen.has(id)) continue
      seen.add(id)
      results.push(song)
    }
    return results
  }

  /** `data` 可能是 `{ "songs": [...], "total": N }` 或直接是数组 */
  private extractSongs(data: Record<string, unknown>): RawSong[] {
    const rawData = data['data']
    const rows: unknown[] = []
    if (isRecord(rawData)) {
      const songs = rawData['songs']
      if (Array.isArray(songs)) rows.push(...songs)
    } else if (Array.isArray(rawData)) {
      rows.push(...rawData)
    }

    const songs: RawSong[] = []
    for (const row of rows) {
      if (!isRecord(row)) continue
      const mapped = ChkszMusicClient.mapSearchItem(row)
      if (mapped != null) songs.push(mapped)
    }
    return songs
  }

  /**
   * 网易云搜索行 → 应用 song map；不可用返回 null。
   * 搜索行封面在顶层 `picUrl`；歌单曲目用 `al.picUrl`。
   */
  static mapSearchItem(raw: Record<string, unknown>): RawSong | null {
    const id = raw['id']?.toString() ?? ''
    const name = raw['name']?.toString().trim() ?? ''
    if (id === '' || name === '') return null

    const albumRaw = raw['al'] ?? raw['album']
    const coverUrl = picUrlOf(raw) ?? picUrlOf(albumRaw)
    const durationMs = dtMs(raw['dt'] ?? raw['duration'])

    return {
      id: ChkszMusicClient.buildSongId(id),
      title: name,
      artist: artistText(raw['ar'] ?? raw['artists']),
      album: albumName(albumRaw),
      ...(coverUrl != null ? { coverUrl } : {}),
      ...(durationMs > 0 ? { duration: durationMs } : {}),
      resultType: 'song',
      source: 'chksz',
      sourceLabel: 'ChKSz · 网易云',
      metaSource: 'ChKSz',
      playbackSource: 'chksz',
    }
  }

  // === 播放地址 ===

  /**
   * 解析 `chksz:163:` 歌曲的可播放 URL（音质阶梯 exhigh → standard，
   * 每次探测以 urlAttemptTimeout 为上限）。
   *
   * 解析接口同时返回 `picUrl` —— 作为 PlaybackUrl.coverUrl 回传，
   * 播放器在 song map 本身无封面时也能显示封面。
   */
  async getPlayUrl(songId: string): Promise<PlaybackUrl> {
    const neteaseId = ChkszMusicClient.parseSongId(songId)
    if (neteaseId == null) {
      throw new Error(`invalid chksz song id: ${songId}`)
    }

    let url: string | null = null
    let coverUrl: string | null = null
    let lastError: unknown = null
    for (const level of ChkszMusicClient.qualityLadder) {
      try {
        const hit = await this.fetchUrl(neteaseId, level)
        if (hit != null && hit.url !== '') {
          url = hit.url
          coverUrl = hit.picUrl
          break
        }
      } catch (e) {
        if (e instanceof ChkszApiKeyMissingError) throw e
        if (e instanceof ChkszApiError) {
          if (!isQualityLevelMiss(e)) {
            // 鉴权/限流等系统性错误（key 错、被封）—— 停止探测并上抛
            throw e
          }
          // 「该音质无地址」只是单音质信号，降一档往往就有，继续阶梯
          lastError = e
          console.log(`[ChKSz] url level=${level} unavailable: ${e.message}`)
          continue
        }
        lastError = e
        console.log(`[ChKSz] url level=${level} failed: ${e}`)
      }
    }

    if (url == null || url === '') {
      throw new Error(
        `ChKSz 未返回播放地址 (${songId})${lastError == null ? '' : `: ${lastError}`}`,
      )
    }

    const normalized = url.startsWith('http://')
      ? `https://${url.substring('http://'.length)}`
      : url
    return playbackUrl(normalized, {
      headers: {},
      lyrics: '',
      resolvedId: songId,
      coverUrl: coverUrl ?? '',
    })
  }

  /**
   * 歌曲详情走解析接口（API 没有独立详情接口；163_music 在 url 之外
   * 还返回 name/artist/album/picUrl）。
   */
  async getSongDetail(songId: string): Promise<RawSong> {
    const neteaseId = ChkszMusicClient.parseSongId(songId)
    if (neteaseId == null) return { id: songId }
    try {
      const data = await this.getJson('/api/163_music', {
        id: neteaseId,
        level: ChkszMusicClient.qualityLadder[0] ?? 'exhigh',
        type: 'json',
      })
      const rawData = data['data']
      if (!isRecord(rawData)) return { id: songId }
      return {
        id: songId,
        title: rawData['name']?.toString() ?? '',
        artist: artistText(rawData['artist']),
        album: rawData['album']?.toString() ?? '',
        coverUrl: toHttps(rawData['picUrl']?.toString().trim() ?? ''),
        resultType: 'song',
        source: 'chksz',
        sourceLabel: 'ChKSz · 网易云',
      }
    } catch {
      return { id: songId }
    }
  }

  private async fetchUrl(
    neteaseId: string,
    level: string,
  ): Promise<UrlHit | null> {
    const data = await this.getJson(
      '/api/163_music',
      { id: neteaseId, level, type: 'json' },
      ChkszMusicClient.urlAttemptTimeout,
    )
    const rawData = data['data']
    if (!isRecord(rawData)) return null
    const url = rawData['url']?.toString().trim() ?? ''
    if (url === '') return null
    const picUrl = rawData['picUrl']?.toString().trim() ?? ''
    return { url, picUrl: picUrl === '' ? '' : toHttps(picUrl) }
  }

  // === 歌词 ===

  /** 网易云 LRC；原文为空时回退翻译歌词 */
  async getLyric(songId: string): Promise<string> {
    const neteaseId = ChkszMusicClient.parseSongId(songId)
    if (neteaseId == null) return ''
    const data = await this.getJson('/api/163_lyric', { id: neteaseId })
    const rawData = data['data']
    if (!isRecord(rawData)) return ''
    const lrc = rawData['lrc']?.toString().trim() ?? ''
    if (lrc !== '' && lrc !== 'null') return lrc
    const tlyric = rawData['tlyric']?.toString().trim() ?? ''
    if (tlyric === '' || tlyric === 'null') return ''
    return tlyric
  }

  // === 歌单 ===

  /** 歌单详情；曲目映射为 `chksz:163:` 歌曲 id */
  async getPlaylist(playlistId: string, limit?: number): Promise<RawSong> {
    const neteaseId = ChkszMusicClient.parsePlaylistId(playlistId)
    if (neteaseId == null) {
      throw new Error(`invalid chksz playlist id: ${playlistId}`)
    }
    const data = await this.getJson('/api/163_playlist', { id: neteaseId })
    const playlist = ChkszMusicClient.mapPlaylist(data['data'])
    // 歌单接口没有部分加载参数；本地切片
    if (limit != null && limit > 0) {
      const songs = playlist['songs']
      if (Array.isArray(songs) && songs.length > limit) {
        playlist['songs'] = songs.slice(0, limit)
        playlist['songCount'] = limit
      }
    }
    return playlist
  }

  static mapPlaylist(raw: unknown): RawSong {
    if (!isRecord(raw)) return { resultType: 'playlist' }

    const tracks: unknown[] = [
      ...(Array.isArray(raw['songs']) ? (raw['songs'] as unknown[]) : []),
      ...(Array.isArray(raw['tracks']) ? (raw['tracks'] as unknown[]) : []),
    ]
    const songs: RawSong[] = []
    for (const track of tracks) {
      if (!isRecord(track)) continue
      const mapped = ChkszMusicClient.mapSearchItem(track)
      if (mapped != null) songs.push(mapped)
    }

    const creator = raw['creator']
    const coverUrl = picUrlOf(raw)

    return {
      id: ChkszMusicClient.buildPlaylistId(ChkszMusicClient.neteaseIdOf(raw)),
      title: raw['name']?.toString() ?? '',
      artist: isRecord(creator) ? (creator['nickname']?.toString() ?? '') : '',
      songs,
      resultType: 'playlist',
      songCount: songs.length,
      ...(coverUrl != null ? { coverUrl } : {}),
      source: 'chksz',
      sourceLabel: 'ChKSz · 网易云',
    }
  }

  static neteaseIdOf(map: Record<string, unknown>): string {
    return map['id']?.toString() ?? ''
  }

  // === 传输层 ===

  /**
   * 带 `apikey` 的 GET JSON。未配置 key 时在发请求前抛
   * ChkszApiKeyMissingError；业务错误（`code` 存在且 != 200）抛 ChkszApiError。
   */
  private async getJson(
    path: string,
    query: Record<string, string | number>,
    timeoutMs: number = ChkszMusicClient.defaultRequestTimeout,
  ): Promise<Record<string, unknown>> {
    const key = this.apiKey
    if (key === '') {
      throw new ChkszApiKeyMissingError()
    }

    const params = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...query, apikey: key })) {
      params.set(k, String(v))
    }
    const url = `${this.baseUrl}${path}?${params.toString()}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetch(url, {
        headers: DEFAULT_HEADERS,
        signal: controller.signal,
      })
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        // 对应 Dart Future.timeout 的 TimeoutException：通用错误，
        // 在 getPlayUrl 中按"单音质探测失败"处理
        throw new Error(`ChKSz 请求超时 (${timeoutMs}ms)`)
      }
      // 网络层失败（无响应）——对应 DioException 无 response 的分支
      throw new ChkszApiError('ChKSz 请求失败 (HTTP 连接错误)')
    } finally {
      clearTimeout(timer)
    }

    // HTTP 401/403 → 可读鉴权错误；其他 HTTP 失败保留状态码
    if (!response.ok) {
      throw httpError(response.status)
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new ChkszApiError('ChKSz 响应格式错误')
    }
    if (!isRecord(data)) {
      throw new ChkszApiError('ChKSz 响应格式错误')
    }
    const code = data['code']
    if (typeof code === 'number' && code !== 200) {
      throw new ChkszApiError(
        data['msg']?.toString() ?? `ChKSz 业务错误 (code=${code})`,
      )
    }
    return data
  }
}

/**
 * 「这首歌在该音质下没有地址」——上游返回 `code: 404` 且 msg 形如
 * `Music URL not found, song may be unavailable at this quality level`。
 *
 * 这是**单音质**信号（降一档常常就有），与 key 错/限流这类系统性错误不同，
 * 不能直接上抛、放弃整条音质阶梯。
 */
export function isQualityLevelMiss(error: ChkszApiError): boolean {
  return /quality level|music url not found/i.test(error.message)
}

/** HTTP 401/403 → 可读鉴权错误（apikey 无效或缺失）；其他 HTTP 失败保留状态码 */
function httpError(status: number): ChkszApiError {
  return new ChkszApiError(
    status === 401 || status === 403
      ? 'ChKSz API 密钥无效或未授权，请在设置中检查'
      : `ChKSz 请求失败 (HTTP ${status})`,
  )
}

// === 共享映射 helpers（对应 client 的静态私有方法） ===

function artistText(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw
      .map(singleArtistName)
      .filter((name) => name !== '')
      .join(' / ')
  }
  return singleArtistName(raw)
}

function singleArtistName(raw: unknown): string {
  if (isRecord(raw)) {
    const name = (raw['name'] ?? raw['nickname'] ?? raw['userName'])?.toString()
    return name?.trim() ?? ''
  }
  return raw?.toString().trim() ?? ''
}

function albumName(raw: unknown): string {
  if (!isRecord(raw)) return ''
  return raw['name']?.toString().trim() ?? ''
}

function picUrlOf(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  const pic =
    (raw['picUrl'] ?? raw['coverImgUrl'] ?? raw['pic'])?.toString().trim() ?? ''
  if (pic === '') return null
  return toHttps(pic)
}

function toHttps(url: string): string {
  if (url.startsWith('http://')) return `https://${url.substring(7)}`
  return url
}

/** 网易云时长（`dt`）是毫秒；兼容秒 */
function dtMs(value: unknown): number {
  if (value == null) return 0
  if (typeof value === 'number') {
    return value > 10000 ? Math.round(value) : Math.round(value * 1000)
  }
  const n = Number.parseInt(value.toString().trim(), 10)
  if (Number.isNaN(n)) return 0
  return n > 10000 ? n : n * 1000
}

// ================= Provider =================

export interface ChkszMusicProviderOptions {
  client?: ChkszMusicClient
  /** 运行时 key provider（设置页）；等价于 new ChkszMusicClient({ apiKeyProvider }) */
  apiKeyProvider?: ChkszApiKeyProvider
  /** 静态 key */
  apiKey?: string
  baseUrl?: string
}

/**
 * ChKSz 网易云 provider —— `chksz:` 前缀 id 的搜索、直链播放、歌词与歌单。
 *
 * 通过网易云直链播放（无自定义请求头），桌面播放器可直接流播。
 * 播放失败在 Hybrid 层回退 B 站按标题匹配，绝不在本 provider 内回退。
 */
export class ChkszMusicProvider implements MusicProvider {
  private readonly client: ChkszMusicClient
  private readonly cache = new Map<string, RawSong>()

  constructor(options: ChkszMusicProviderOptions = {}) {
    this.client =
      options.client ??
      new ChkszMusicClient({
        baseUrl: options.baseUrl,
        apiKeyProvider: options.apiKeyProvider,
        apiKey: options.apiKey,
      })
  }

  async searchSongs(query: string, page = 1): Promise<RawSong[]> {
    const results = await this.client.searchSongs(query, page)
    this.cacheSongs(results)
    return results
  }

  getPlayUrl(id: string): Promise<PlaybackUrl> {
    return this.client.getPlayUrl(id)
  }

  async getLyrics(song: RawSong): Promise<string> {
    const existing = song['lyrics']?.toString().trim() ?? ''
    if (existing !== '') return existing
    const id = song['id']?.toString() ?? ''
    if (!ChkszMusicClient.isChkszSongId(id)) return ''
    try {
      return await this.client.getLyric(id)
    } catch {
      return ''
    }
  }

  async getSongDetail(id: string): Promise<RawSong> {
    // ChKSz API 没有独立详情接口；解析接口（163_music）在播放地址之外
    // 返回 name/artist/album/picUrl。优先用缓存行，否则问客户端。
    const cached = this.cache.get(id)
    if (cached != null && (cached['title']?.toString().trim() ?? '') !== '') {
      return cached
    }
    try {
      const detail = await this.client.getSongDetail(id)
      if ((detail['title']?.toString().trim() ?? '') !== '') {
        this.cache.set(id, { ...(cached ?? {}), ...detail })
        return detail
      }
    } catch {
      /* ignore */
    }
    return { id }
  }

  getPlaylist(id: string, limit?: number): Promise<RawSong> {
    return this.client.getPlaylist(id, limit)
  }

  async getRecommendedSongs(): Promise<RawSong[]> {
    return []
  }

  async getHotPlaylists(_opts?: {
    limit?: number
    offset?: number
  }): Promise<RawSong[]> {
    return []
  }

  rememberSongs(songs: RawSong[]): void {
    this.cacheSongs(songs)
  }

  private cacheSongs(songs: RawSong[]): void {
    for (const song of songs) {
      const id = song['id']?.toString() ?? ''
      if (id !== '') this.cache.set(id, song)
    }
  }
}

/**
 * ChKSz provider 解析器：每次取用时按**当前** key 返回 provider，未配置 key 时返回 null。
 *
 * 为什么需要它：设置页改了 key 必须立即生效，而不是重启后才生效
 * （Dart 端由 Riverpod 的 provider 重建天然做到；TS 端原先是启动时快照 key，
 * 表现为「在设置页填了 key 却搜不到 ChKSz」）。
 */
export type ChkszResolver = () => ChkszMusicProvider | null

/**
 * 构造随设置变化的 ChKSz 解析器。
 *
 * 内部按 key 缓存实例：key 不变时复用（保留 getSongDetail 的歌曲缓存），
 * key 变化（清空 / 换成另一个）时立即换成新实例 —— 与 Dart 端 provider 重建等价。
 */
export function createChkszResolver(
  keyProvider: ChkszApiKeyProvider,
  options: { baseUrl?: string } = {},
): ChkszResolver {
  let key = ''
  let provider: ChkszMusicProvider | null = null
  return () => {
    const current = keyProvider().trim()
    if (current === '') {
      if (provider != null) {
        provider = null
        key = ''
      }
      return null
    }
    if (provider == null || current !== key) {
      key = current
      provider = new ChkszMusicProvider({ apiKey: current, baseUrl: options.baseUrl })
    }
    return provider
  }
}

/** 「测试连接」的结果 */
export interface ChkszKeyCheck {
  ok: boolean
  message: string
}

/**
 * 验证一个 ChKSz key 是否可用（设置页「测试连接」用）。
 *
 * 打一次真实的 163_search（1 首），把鉴权/业务/网络错误翻译成人话 ——
 * 用户填写 key 后能立即知道到底通不通，而不是靠去搜一次猜。
 */
export async function verifyChkszKey(
  apiKey: string,
  options: { baseUrl?: string } = {},
): Promise<ChkszKeyCheck> {
  const trimmed = apiKey.trim()
  if (trimmed === '') return { ok: false, message: '请先填写 API Key' }

  const client = new ChkszMusicClient({
    apiKey: trimmed,
    baseUrl: options.baseUrl,
    searchTimeout: 8000,
  })
  try {
    const songs = await client.searchSongs('周杰伦', 1)
    return songs.length > 0
      ? { ok: true, message: `连接正常，返回 ${songs.length} 首结果` }
      : { ok: true, message: '接口可访问（未返回结果，请试搜其他关键词）' }
  } catch (error) {
    if (error instanceof ChkszApiKeyMissingError) {
      return { ok: false, message: '未配置 API Key' }
    }
    if (error instanceof ChkszApiError) {
      return { ok: false, message: error.message }
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
