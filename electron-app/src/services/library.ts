/**
 * 音乐库服务 —— 完整移植 lib/services/library_service.dart 的 LibraryNotifier
 * （并合并其内嵌的 HTTP LibraryService）。
 *
 * 灵魂语义，逐条对应 Dart 实现，未做简化：
 * - 乐观更新：先改本地 state，再通过 _enqueueRemoteMutation 排队 PUT /library；
 *   失败时按 entity claim 归属回滚本地。
 * - mutation 队列：_mutationTail 单链顺序执行，前序失败不阻塞后续（tail 用恢复分支续链）。
 * - generation：loadLibrary/setLibraryFromLogin/clearAccountLibrary 递增
 *   _libraryGeneration 并清空队列与 claim；过期操作抛 LibraryMutationCancelled。
 * - entity claim：_claimEntities/_ownsEntity/_releaseEntity，回滚只在自己仍拥有
 *   实体时进行（防止覆盖更新操作写入的状态）。
 * - toggleLike 还有按 like:{identity} 的 per-entity 副队列（_likeMutationTails），
 *   同一歌曲的快速连续点按被串行化。
 * - addSongToPlaylist 里 Dart 用 identical() 做引用相等判断，TS 端保持同一对象引用
 *   （rawSong/resolvedMap 只创建一次），用 === 等价表达。
 *
 * 与 Dart 的差异（语义取舍）：
 * - token 不再逐方法传参，改构造注入 tokenProvider（任务要求）；401 时回调
 *   onAuthExpired 再抛 ApiError（Dart 端无此钩子，属新增）。
 * - 本地只持久化播放历史（key 'play_history'，与 Dart 一致）；liked/playlists
 *   与 Dart 一样不落地本地快照，完全以远端为准。
 * - Dart DateTime.now().toIso8601String() 是本地时间无 Z；TS 用
 *   new Date().toISOString()（UTC 带 Z），仅影响 createdAt/collectedAt 显示格式。
 * - play_history 在 localStorage 中以 JSON 数组字符串落地（Dart 是 StringList），
 *   对外 key 名一致。
 */

import {
  songCopyWith,
  songFromJson,
  songToJson,
  type Song,
} from './models'
import { createDefaultStorage, type KeyValueStorage } from './storage'
import { ApiError } from './auth'

export const LIBRARY_BASE_URL = 'http://60.205.218.90:8787/api'
/** localStorage key —— 与 Dart SharedPreferences key 一致 */
export const HISTORY_KEY = 'play_history'

const REQUEST_TIMEOUT_MS = 10_000
const HISTORY_LIMIT = 50

export class LibraryMutationCancelled extends Error {
  constructor(message = 'Library mutation cancelled') {
    super(message)
    this.name = 'LibraryMutationCancelled'
  }
}

export type PlaybackMetadataResolver = (song: Song) => Promise<Record<string, unknown>>

// ---------------------------------------------------------------------------
// song_identity.dart 移植
// ---------------------------------------------------------------------------

/** 等价 Dart songIdentityValues */
export function songIdentityValues(song: Record<string, unknown>): Set<string> {
  const result = new Set<string>()
  for (const key of ['id', 'playbackId', 'sourceId', 'playbackSourceId']) {
    const text = asString(song[key]).trim()
    if (text !== '') result.add(canonicalSongIdentity(text))
  }
  return result
}

/** 等价 Dart songsShareIdentity */
export function songsShareIdentity(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
): boolean {
  const firstIds = songIdentityValues(first)
  for (const id of songIdentityValues(second)) {
    if (firstIds.has(id)) return true
  }
  return false
}

function canonicalSongIdentity(id: string): string {
  if (!id.startsWith('bilibili:')) return id
  const parts = id.split(':')
  if (parts.length < 2 || parts[1] === '') return id
  if (parts.length === 2) return `bilibili:${parts[1]}:p1`
  const page = Number.parseInt(parts[2].replace(/^[pP]/, ''), 10)
  if (Number.isNaN(page)) return id
  return `bilibili:${parts[1]}:p${page < 1 ? 1 : page}`
}

// ---------------------------------------------------------------------------
// RemoteLibrary（与移动端 API 结构一致）
// ---------------------------------------------------------------------------

export interface RemoteLibrary {
  likedSongs: Record<string, unknown>[]
  userPlaylists: Record<string, unknown>[]
  themeMode: string
}

export function remoteLibraryFromJson(json: Record<string, unknown>): RemoteLibrary {
  return {
    likedSongs: listOfMaps(json['likedSongs']),
    userPlaylists: listOfMaps(json['userPlaylists']),
    themeMode: asString(json['themeMode']) || 'dark',
  }
}

export interface LibraryState {
  likedSongs: Song[]
  /** 仅本地，不同步服务端 */
  playHistory: Song[]
  /** 用户收藏与自建歌单（服务端同步字段为松散 map，与 Dart 一致） */
  userPlaylists: Record<string, unknown>[]
  themeMode: string
  isLoading: boolean
}

export interface LibraryServiceDeps {
  tokenProvider: () => string
  onAuthExpired?: () => void
  storage?: KeyValueStorage
  baseUrl?: string
  fetchImpl?: typeof fetch
  playbackResolver?: PlaybackMetadataResolver
}

export type LibraryListener = (state: LibraryState) => void

// ---------------------------------------------------------------------------
// 小工具（对应 Dart 端的 ?.toString() ?? '' 等宽松转换）
// ---------------------------------------------------------------------------

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function listOfMaps(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => asRecord(item) != null)
}

function firstText(first: unknown, second: unknown): string {
  const firstText = asString(first).trim()
  if (firstText !== '') return firstText
  return asString(second).trim()
}

/** 歌曲 JSON 里可用的封面地址（空字符串 = 没有封面） */
function coverUrlOf(song: Record<string, unknown>): string {
  return asString(song['coverUrl']).trim()
}

/**
 * 自建歌单首次加歌时回填封面：歌单此前没有封面（''、null、undefined），
 * 而本次加入的歌有封面时写进歌单记录，否则自建歌单永远是一张渐变占位。
 * - 收藏/远端歌单（isCollected === true）不受影响；
 * - 已有封面的歌单不覆盖；`previousCover` 是本次乐观更新刚写进去的封面，
 *   允许被解析后的最终封面（resolvedMap）替换。
 */
function withBackfilledCover(
  playlist: Record<string, unknown>,
  cover: string,
  previousCover = '',
): Record<string, unknown> {
  if (cover === '') return playlist
  if (playlist['isCollected'] === true) return playlist
  const existing = coverUrlOf(playlist)
  if (existing !== '' && existing !== previousCover) return playlist
  return { ...playlist, coverUrl: cover }
}

function parseBilibiliPage(value: unknown): number {
  const text = asString(value).trim()
  const parsed = Number.parseInt(text.replace(/^[pP]/, ''), 10)
  const page = Number.isNaN(parsed) ? 1 : parsed
  return page < 1 ? 1 : page
}

// ---------------------------------------------------------------------------
// LibraryService（= Dart LibraryNotifier + 内嵌 HTTP client）
// ---------------------------------------------------------------------------

export class LibraryService {
  private readonly tokenProvider: () => string
  private readonly onAuthExpired?: () => void
  private readonly storage: KeyValueStorage
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly playbackResolver?: PlaybackMetadataResolver

  private state: LibraryState = {
    likedSongs: [],
    playHistory: [],
    userPlaylists: [],
    themeMode: 'light',
    isLoading: false,
  }
  private readonly listeners = new Set<LibraryListener>()

  private committedLibrary: RemoteLibrary = {
    likedSongs: [],
    userPlaylists: [],
    themeMode: 'light',
  }
  private mutationTail: Promise<void> = Promise.resolve()
  private libraryGeneration = 0
  private nextOperationId = 0
  private readonly entityOwners = new Map<string, number>()
  private readonly likeMutationTails = new Map<string, Promise<void>>()

  constructor(deps: LibraryServiceDeps) {
    this.tokenProvider = deps.tokenProvider
    this.onAuthExpired = deps.onAuthExpired
    this.storage = deps.storage ?? createDefaultStorage()
    this.baseUrl = deps.baseUrl ?? LIBRARY_BASE_URL
    this.fetchImpl = deps.fetchImpl ?? ((...args) => fetch(...args))
    this.playbackResolver = deps.playbackResolver
    this.loadStoredHistory()
  }

  // ---- 状态访问与订阅 ----

  getSnapshot(): LibraryState {
    return { ...this.state }
  }

  get likedSongs(): Song[] {
    return this.state.likedSongs
  }

  get history(): Song[] {
    return this.state.playHistory
  }

  get playHistory(): Song[] {
    return this.state.playHistory
  }

  get playlists(): Record<string, unknown>[] {
    return this.state.userPlaylists
  }

  get userPlaylists(): Record<string, unknown>[] {
    return this.state.userPlaylists
  }

  get themeMode(): string {
    return this.state.themeMode
  }

  get isLoading(): boolean {
    return this.state.isLoading
  }

  subscribe(listener: LibraryListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setState(patch: Partial<LibraryState>): void {
    this.state = { ...this.state, ...patch }
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }

  // ---- 播放历史（仅本地持久化） ----

  /** 等价 Dart _loadStoredHistory */
  private loadStoredHistory(): void {
    const historyJson = this.storage.getStringList(HISTORY_KEY)
    const songs: Song[] = []
    for (const jsonStr of historyJson) {
      try {
        const json = asRecord(JSON.parse(jsonStr))
        if (json != null) songs.push(songFromJson(json))
      } catch {
        /* 单条损坏跳过，与 Dart whereType<Song>() 容错一致 */
      }
    }
    this.setState({ playHistory: songs })
  }

  /** 等价 Dart _saveHistory */
  private async saveHistory(): Promise<void> {
    const historyJson = this.state.playHistory.map((s) => JSON.stringify(songToJson(s)))
    this.storage.setStringList(HISTORY_KEY, historyJson)
  }

  /** 等价 Dart addToHistory（仅本地，持久化到存储） */
  async addToHistory(song: Song): Promise<void> {
    const newHistory = [song, ...this.state.playHistory.filter((s) => s.id !== song.id)]
    if (newHistory.length > HISTORY_LIMIT) newHistory.length = HISTORY_LIMIT
    this.setState({ playHistory: newHistory })
    await this.saveHistory()
  }

  /** 等价 Dart updateStoredSong：异步播放元数据（如歌词）到达后合并进已存歌曲 */
  async updateStoredSong(song: Record<string, unknown>): Promise<void> {
    const id = asString(song['id'])
    if (id === '') return

    const merge = (existing: Song): Song =>
      songFromJson({ ...songToJson(existing), ...song })

    this.setState({
      likedSongs: this.state.likedSongs.map((existing) =>
        existing.id === id ? merge(existing) : existing,
      ),
      playHistory: this.state.playHistory.map((existing) =>
        existing.id === id ? merge(existing) : existing,
      ),
    })
    await this.saveHistory()
  }

  /** 等价 Dart clearHistory（仅本地） */
  async clearHistory(): Promise<void> {
    this.setState({ playHistory: [] })
    this.storage.remove(HISTORY_KEY)
  }

  /** 等价 Dart loadPlayHistory：历史在构造时已加载，这里只收尾 loading */
  loadPlayHistory(): void {
    this.setState({ isLoading: false })
  }

  // ---- 远端加载 ----

  /** 等价 Dart loadLibrary */
  async loadLibrary(): Promise<void> {
    const generation = this.libraryGeneration
    const mutationMarker = this.nextOperationId
    const hadPendingMutation = this.entityOwners.size > 0
    this.setState({ isLoading: true })
    try {
      const library = await this.getRemoteLibrary()
      if (generation !== this.libraryGeneration) return
      if (
        hadPendingMutation ||
        mutationMarker !== this.nextOperationId ||
        this.entityOwners.size > 0
      ) {
        this.setState({ isLoading: false })
        return
      }
      this.applyRemoteLibrary(library, false)
    } catch (error) {
      if (generation !== this.libraryGeneration) return
      this.setState({ isLoading: false })
      throw error
    }
  }

  /** 等价 Dart loadLikedSongs */
  async loadLikedSongs(): Promise<void> {
    await this.loadLibrary()
  }

  /** 等价 Dart setLibraryFromLogin */
  setLibraryFromLogin(library: RemoteLibrary): void {
    this.applyRemoteLibrary(library, false)
  }

  /** 等价 Dart clearAccountLibrary */
  clearAccountLibrary(): void {
    this.startLibraryGeneration()
    this.setState({ likedSongs: [], userPlaylists: [] })
    this.committedLibrary = {
      likedSongs: [],
      userPlaylists: [],
      themeMode: this.state.themeMode,
    }
  }

  /** 等价 Dart _applyRemoteLibrary */
  private applyRemoteLibrary(library: RemoteLibrary, isLoading?: boolean): void {
    this.startLibraryGeneration()
    const likedSongs = library.likedSongs.map((song) => this.withMobilePlaybackFields(song))
    const songs = likedSongs.map((s) => songFromJson(s))
    // 归一化 name/title（和 description/subtitle），使侧栏与详情页一致
    const playlists = library.userPlaylists.map((playlist) =>
      this.withLibraryPlaylistFields(playlist),
    )
    this.committedLibrary = {
      likedSongs,
      userPlaylists: playlists,
      themeMode: library.themeMode,
    }
    this.setState({
      likedSongs: songs,
      userPlaylists: playlists,
      themeMode: library.themeMode,
      ...(isLoading !== undefined ? { isLoading } : {}),
    })
  }

  /** 等价 Dart _startLibraryGeneration */
  private startLibraryGeneration(): void {
    this.libraryGeneration++
    this.mutationTail = Promise.resolve()
    this.entityOwners.clear()
    this.likeMutationTails.clear()
  }

  // ---- mutation 队列（灵魂，等价 Dart _enqueueRemoteMutation） ----

  private enqueueRemoteMutation(
    buildCandidate: (committed: RemoteLibrary) => RemoteLibrary,
  ): Promise<void> {
    const generation = this.libraryGeneration
    const operation = this.mutationTail.then(async () => {
      if (generation !== this.libraryGeneration) {
        throw new LibraryMutationCancelled('Account library changed')
      }
      const candidate = buildCandidate(this.committedLibrary)
      await this.saveRemoteLibrary(candidate)
      if (generation !== this.libraryGeneration) {
        throw new LibraryMutationCancelled('Account library changed')
      }
      this.committedLibrary = candidate
    })
    // tail 永远恢复，前序失败不阻塞后续 mutation
    this.mutationTail = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  /** 等价 Dart _candidateLibrary */
  private candidateLibrary(
    committed: RemoteLibrary,
    patch: {
      likedSongs?: Record<string, unknown>[]
      userPlaylists?: Record<string, unknown>[]
    },
  ): RemoteLibrary {
    return {
      likedSongs: patch.likedSongs ?? committed.likedSongs,
      userPlaylists: patch.userPlaylists ?? committed.userPlaylists,
      themeMode: committed.themeMode,
    }
  }

  // ---- entity claim（等价 Dart _claimEntities/_ownsEntity/_releaseEntity） ----

  private claimEntities(keys: Iterable<string>): number {
    const operationId = ++this.nextOperationId
    for (const key of keys) {
      this.entityOwners.set(key, operationId)
    }
    return operationId
  }

  private ownsEntity(key: string, operationId: number): boolean {
    return this.entityOwners.get(key) === operationId
  }

  private releaseEntity(key: string, operationId: number): void {
    if (this.ownsEntity(key, operationId)) this.entityOwners.delete(key)
  }

  // ---- toggleLike（含 per-entity 副队列，等价 Dart toggleLike/_toggleLikeNow） ----

  /**
   * 「已喜欢」判定 —— 必须用身份比较（songsShareIdentity），**不能**用严格 id 相等。
   * 同一首歌在不同入口的 id 可能不同：B 站分P歌进库后会带上 `:pN` 后缀
   * （收藏时存的是 `bilibili:BV...:p1`，而当前播放的曲 id 是 `bilibili:BV...`），
   * 严格比较会得出「未收藏」，表现为点心形按钮没反应/歌词窗心形不高亮
   * （2026-10 真实回归：收藏其实已经写入云端，只是 UI 不认）。
   */
  isLiked(song: Song): boolean {
    if (song.isFavorite) return true
    const raw = songToJson(song)
    return this.state.likedSongs.some((item) => songsShareIdentity(songToJson(item), raw))
  }

  toggleLike(song: Song): Promise<void> {
    const identities = songIdentityValues(songToJson(song))
    if (identities.size === 0) {
      return Promise.reject(
        new TypeError(`Song identity is required (song.id: ${song.id})`),
      )
    }
    const generation = this.libraryGeneration
    const entityKey = `like:${identities.values().next().value as string}`
    const previous = this.likeMutationTails.get(entityKey) ?? Promise.resolve()
    const recoveredPrevious = previous.then(
      () => undefined,
      () => undefined,
    )
    const operation = recoveredPrevious
      .then(() => this.toggleLikeNow(song, entityKey, generation))
      .then<void>(
        () => {
          if (this.likeMutationTails.get(entityKey) === operation) {
            this.likeMutationTails.delete(entityKey)
          }
        },
        (error: unknown) => {
          if (this.likeMutationTails.get(entityKey) === operation) {
            this.likeMutationTails.delete(entityKey)
          }
          throw error
        },
      )
    this.likeMutationTails.set(entityKey, operation)
    return operation
  }

  private async toggleLikeNow(
    song: Song,
    entityKey: string,
    generation: number,
  ): Promise<void> {
    if (generation !== this.libraryGeneration) {
      throw new LibraryMutationCancelled('Account library changed')
    }
    const rawSong = songToJson(song)
    const isLiked = this.state.likedSongs.some((item) =>
      songsShareIdentity(songToJson(item), rawSong),
    )
    const removedSong = isLiked
      ? this.state.likedSongs.find((item) => songsShareIdentity(songToJson(item), rawSong))
      : undefined
    const operationId = this.claimEntities([entityKey])
    const resolved = isLiked ? song : await this.resolvePlaybackMetadata(song)
    if (generation !== this.libraryGeneration) {
      this.releaseEntity(entityKey, operationId)
      throw new LibraryMutationCancelled('Account library changed')
    }
    const resolvedMap = songToJson(resolved)

    if (isLiked) {
      this.setState({
        likedSongs: this.state.likedSongs.filter(
          (item) => !songsShareIdentity(songToJson(item), rawSong),
        ),
      })
    } else {
      this.setState({
        likedSongs: [
          ...this.state.likedSongs.filter(
            (item) => !songsShareIdentity(songToJson(item), resolvedMap),
          ),
          songCopyWith(resolved, { isFavorite: true }),
        ],
      })
    }

    try {
      await this.enqueueRemoteMutation((committed) =>
        this.candidateLibrary(committed, {
          likedSongs: isLiked
            ? committed.likedSongs.filter((item) => !songsShareIdentity(item, rawSong))
            : [
                ...committed.likedSongs.filter(
                  (item) => !songsShareIdentity(item, resolvedMap),
                ),
                songToJson(songCopyWith(resolved, { isFavorite: true })),
              ],
        }),
      )
    } catch (error) {
      if (this.ownsEntity(entityKey, operationId)) {
        this.setState({
          likedSongs: isLiked
            ? [
                ...this.state.likedSongs,
                ...(removedSong != null &&
                !this.state.likedSongs.some((item) =>
                  songsShareIdentity(songToJson(item), songToJson(removedSong)),
                )
                  ? [removedSong]
                  : []),
              ]
            : this.state.likedSongs.filter(
                (item) => !songsShareIdentity(songToJson(item), resolvedMap),
              ),
        })
      }
      throw error
    } finally {
      this.releaseEntity(entityKey, operationId)
    }
  }

  // ---- 歌单 mutation ----

  /** 等价 Dart createPlaylist。返回新建的歌单记录（调用方需要 id 继续加歌） */
  async createPlaylist(name: string, description?: string): Promise<Record<string, unknown>> {
    const newPlaylist: Record<string, unknown> = {
      id: Date.now().toString(),
      name,
      title: name,
      description: description ?? '',
      subtitle: description ?? '0 首',
      songs: [],
      createdAt: new Date().toISOString(),
      isCollected: false, // 用户自建
    }

    const entityKey = `playlist:${asString(newPlaylist['id'])}`
    const operationId = this.claimEntities([entityKey])
    this.setState({ userPlaylists: [...this.state.userPlaylists, newPlaylist] })

    try {
      await this.enqueueRemoteMutation((committed) =>
        this.candidateLibrary(committed, {
          userPlaylists: [...committed.userPlaylists, newPlaylist],
        }),
      )
    } catch (error) {
      if (this.ownsEntity(entityKey, operationId)) {
        this.setState({
          userPlaylists: this.state.userPlaylists.filter(
            (p) => p['id'] !== newPlaylist['id'],
          ),
        })
      }
      throw error
    } finally {
      this.releaseEntity(entityKey, operationId)
    }
    return newPlaylist
  }

  /** 等价 Dart collectPlaylist（已收藏则取消收藏） */
  async collectPlaylist(playlist: Record<string, unknown>): Promise<void> {
    const id = asString(playlist['id'])
    if (id === '') return
    const exists = this.state.userPlaylists.some((p) => asString(p['id']) === id)
    const originalIndex = this.state.userPlaylists.findIndex(
      (item) => asString(item['id']) === id,
    )
    const original = originalIndex >= 0 ? this.state.userPlaylists[originalIndex] : undefined
    const entityKey = `playlist:${id}`
    const operationId = this.claimEntities([entityKey])

    if (exists) {
      this.setState({
        userPlaylists: this.state.userPlaylists.filter((p) => asString(p['id']) !== id),
      })
      try {
        await this.enqueueRemoteMutation((committed) =>
          this.candidateLibrary(committed, {
            userPlaylists: committed.userPlaylists.filter(
              (item) => asString(item['id']) !== id,
            ),
          }),
        )
      } catch (error) {
        if (this.ownsEntity(entityKey, operationId) && original != null) {
          const restored = [...this.state.userPlaylists]
          restored.splice(
            originalIndex < restored.length ? originalIndex : restored.length,
            0,
            original,
          )
          this.setState({ userPlaylists: restored })
        }
        throw error
      } finally {
        this.releaseEntity(entityKey, operationId)
      }
      return
    }

    const collectedPlaylist: Record<string, unknown> = {
      ...this.withLibraryPlaylistFields(playlist),
      isCollected: true,
      collectedAt: new Date().toISOString(),
    }

    this.setState({
      userPlaylists: [
        ...this.state.userPlaylists.filter((p) => asString(p['id']) !== id),
        collectedPlaylist,
      ],
    })

    try {
      await this.enqueueRemoteMutation((committed) =>
        this.candidateLibrary(committed, {
          userPlaylists: [
            ...committed.userPlaylists.filter((item) => asString(item['id']) !== id),
            collectedPlaylist,
          ],
        }),
      )
    } catch (error) {
      if (this.ownsEntity(entityKey, operationId)) {
        this.setState({
          userPlaylists: this.state.userPlaylists.filter(
            (p) => p['id'] !== collectedPlaylist['id'],
          ),
        })
      }
      throw error
    } finally {
      this.releaseEntity(entityKey, operationId)
    }
  }

  /** 等价 Dart addSongToPlaylist（额外：首次加歌时回填自建歌单封面） */
  async addSongToPlaylist(playlistId: string, song: Song): Promise<void> {
    const rawSong = songToJson(song)
    let inserted = false
    const optimisticPlaylists = this.state.userPlaylists.map((playlist) => {
      if (asString(playlist['id']) === playlistId) {
        const songs = [...listOfMaps(playlist['songs'])]
        if (songs.some((item) => songsShareIdentity(item, rawSong))) return playlist
        songs.push(rawSong)
        inserted = true
        // 乐观更新阶段只能拿到 rawSong 的封面，解析后的封面稍后再补
        return withBackfilledCover(
          { ...playlist, songs, songCount: songs.length },
          coverUrlOf(rawSong),
        )
      }
      return playlist
    })
    if (!inserted) return

    const parentEntityKey = `playlist:${playlistId}`
    const entityKeys = new Set<string>([`playlist-song:${playlistId}:${song.id}`])
    const operationId = this.claimEntities(entityKeys)
    this.setState({ userPlaylists: optimisticPlaylists })

    const resolvedSong = await this.resolvePlaybackMetadata(song)
    const resolvedMap = songToJson(resolvedSong)
    const resolvedEntityKey = `playlist-song:${playlistId}:${resolvedSong.id}`
    entityKeys.add(resolvedEntityKey)
    this.entityOwners.set(resolvedEntityKey, operationId)
    const stillPresent = this.state.userPlaylists.some((playlist) => {
      if (asString(playlist['id']) !== playlistId) return false
      // 引用相等（Dart identical）：rawSong 只创建一次并原地保留
      return listOfMaps(playlist['songs']).some((item) => item === rawSong)
    })
    if (!stillPresent) {
      for (const key of entityKeys) {
        this.releaseEntity(key, operationId)
      }
      throw new LibraryMutationCancelled('Song add was cancelled')
    }
    entityKeys.add(parentEntityKey)
    this.entityOwners.set(parentEntityKey, operationId)

    const updatedPlaylists = this.state.userPlaylists.map((playlist) => {
      if (asString(playlist['id']) !== playlistId) return playlist
      const songs = listOfMaps(playlist['songs']).map((item) =>
        item === rawSong ? resolvedMap : item,
      )
      return withBackfilledCover(
        { ...playlist, songs, songCount: songs.length },
        coverUrlOf(resolvedMap) || coverUrlOf(rawSong),
        coverUrlOf(rawSong),
      )
    })

    this.setState({ userPlaylists: updatedPlaylists })

    try {
      await this.enqueueRemoteMutation((committed) => {
        let foundPlaylist = false
        const userPlaylists = committed.userPlaylists.map((playlist) => {
          if (asString(playlist['id']) !== playlistId) return playlist
          foundPlaylist = true
          const songs = [...listOfMaps(playlist['songs'])]
          if (!songs.some((item) => songsShareIdentity(item, resolvedMap))) {
            songs.push(resolvedMap)
          }
          // 远端存档与本地乐观更新保持一致：首次加歌同样回填封面
          return withBackfilledCover(
            { ...playlist, songs, songCount: songs.length },
            coverUrlOf(resolvedMap) || coverUrlOf(rawSong),
            coverUrlOf(rawSong),
          )
        })
        if (!foundPlaylist) {
          throw new Error('Playlist no longer exists')
        }
        return this.candidateLibrary(committed, { userPlaylists })
      })
    } catch (error) {
      this.setState({
        userPlaylists: this.state.userPlaylists.map((playlist) => {
          if (asString(playlist['id']) !== playlistId) return playlist
          const songs = listOfMaps(playlist['songs']).filter(
            (item) => item !== resolvedMap,
          )
          return { ...playlist, songs, songCount: songs.length }
        }),
      })
      if (
        this.ownsEntity(parentEntityKey, operationId) &&
        !this.committedLibrary.userPlaylists.some(
          (playlist) => asString(playlist['id']) === playlistId,
        )
      ) {
        this.setState({
          userPlaylists: this.state.userPlaylists.filter(
            (playlist) => asString(playlist['id']) !== playlistId,
          ),
        })
      }
      throw error
    } finally {
      for (const key of entityKeys) {
        this.releaseEntity(key, operationId)
      }
    }
  }

  /** 等价 Dart removeSongsFromPlaylist */
  async removeSongsFromPlaylist(playlistId: string, songIds: Set<string>): Promise<void> {
    if (songIds.size === 0) return
    const removedSongs: { index: number; song: Record<string, unknown> }[] = []
    for (const playlist of this.state.userPlaylists) {
      if (asString(playlist['id']) !== playlistId) continue
      const songs = listOfMaps(playlist['songs'])
      for (let index = 0; index < songs.length; index++) {
        const song = songs[index]
        if (songIds.has(asString(song['id']))) {
          removedSongs.push({ index, song })
        }
      }
    }
    if (removedSongs.length === 0) return
    const entityKeys = [...songIds].map((id) => `playlist-song:${playlistId}:${id}`)
    const operationId = this.claimEntities(entityKeys)
    const updatedPlaylists = this.state.userPlaylists.map((playlist) => {
      if (asString(playlist['id']) !== playlistId) return playlist
      const songs = listOfMaps(playlist['songs']).filter(
        (song) => !songIds.has(asString(song['id'])),
      )
      return { ...playlist, songs, songCount: songs.length }
    })

    this.setState({ userPlaylists: updatedPlaylists })

    try {
      await this.enqueueRemoteMutation((committed) =>
        this.candidateLibrary(committed, {
          userPlaylists: committed.userPlaylists.map((playlist) => {
            if (asString(playlist['id']) !== playlistId) return playlist
            const songs = listOfMaps(playlist['songs']).filter(
              (song) => !songIds.has(asString(song['id'])),
            )
            return { ...playlist, songs, songCount: songs.length }
          }),
        }),
      )
    } catch (error) {
      this.setState({
        userPlaylists: this.state.userPlaylists.map((playlist) => {
          if (asString(playlist['id']) !== playlistId) return playlist
          const songs = [...listOfMaps(playlist['songs'])]
          for (const removed of removedSongs) {
            const id = asString(removed.song['id'])
            const key = `playlist-song:${playlistId}:${id}`
            if (
              this.ownsEntity(key, operationId) &&
              !songs.some((song) => asString(song['id']) === id)
            ) {
              songs.splice(
                removed.index < songs.length ? removed.index : songs.length,
                0,
                removed.song,
              )
            }
          }
          return { ...playlist, songs, songCount: songs.length }
        }),
      })
      throw error
    } finally {
      for (const key of entityKeys) {
        this.releaseEntity(key, operationId)
      }
    }
  }

  /** 等价 Dart deletePlaylist */
  async deletePlaylist(playlistId: string): Promise<void> {
    if (playlistId === '') return
    const originalIndex = this.state.userPlaylists.findIndex(
      (playlist) => asString(playlist['id']) === playlistId,
    )
    if (originalIndex < 0) return
    const deletedPlaylist = this.state.userPlaylists[originalIndex]
    const entityKey = `playlist:${playlistId}`
    const operationId = this.claimEntities([entityKey])

    this.setState({
      userPlaylists: this.state.userPlaylists.filter(
        (playlist) => asString(playlist['id']) !== playlistId,
      ),
    })

    try {
      await this.enqueueRemoteMutation((committed) =>
        this.candidateLibrary(committed, {
          userPlaylists: committed.userPlaylists.filter(
            (playlist) => asString(playlist['id']) !== playlistId,
          ),
        }),
      )
    } catch (error) {
      if (
        this.ownsEntity(entityKey, operationId) &&
        !this.state.userPlaylists.some(
          (playlist) => asString(playlist['id']) === playlistId,
        )
      ) {
        const restored = [...this.state.userPlaylists]
        restored.splice(
          originalIndex < restored.length ? originalIndex : restored.length,
          0,
          deletedPlaylist,
        )
        this.setState({ userPlaylists: restored })
      }
      throw error
    } finally {
      this.releaseEntity(entityKey, operationId)
    }
  }

  // ---- 播放元数据解析与 B 站字段归一化（等价 Dart 同名私有方法） ----

  private async resolvePlaybackMetadata(song: Song): Promise<Song> {
    if (this.hasStablePlaybackId(song)) {
      return songFromJson(this.withMobilePlaybackFields(songToJson(song)))
    }
    const resolver = this.playbackResolver
    if (resolver == null) {
      return songFromJson(this.withMobilePlaybackFields(songToJson(song)))
    }
    try {
      return songFromJson(this.withMobilePlaybackFields(await resolver(song)))
    } catch {
      // resolver 失败回落到原始歌曲，与 Dart catch (_) 一致
      return songFromJson(this.withMobilePlaybackFields(songToJson(song)))
    }
  }

  private hasStablePlaybackId(song: Song): boolean {
    const playbackId = asString(songToJson(song)['playbackId']).trim()
    return playbackId.startsWith('bilibili:')
  }

  private withMobilePlaybackFields(
    song: Record<string, unknown>,
  ): Record<string, unknown> {
    const id = asString(song['id']).trim()
    const existingPlaybackId = asString(song['playbackId']).trim()
    const source = asString(song['source']).toLowerCase()
    const isBilibili =
      id.startsWith('bilibili:') ||
      existingPlaybackId.startsWith('bilibili:') ||
      source.includes('bilibili')
    if (!isBilibili) return song

    const playbackId = this.canonicalBilibiliPlaybackId(
      existingPlaybackId !== '' ? existingPlaybackId : id,
      song['page'],
    )
    const bvid = this.bvidFromPlaybackId(playbackId)
    const page = this.pageFromPlaybackId(playbackId)
    const shouldNormalizeId = id.startsWith('bilibili:')
    return {
      ...song,
      ...(shouldNormalizeId ? { id: playbackId } : {}),
      playbackId,
      playbackSource: 'bilibili',
      playbackSourceLabel: 'B站',
      playbackSourceId: playbackId,
      sourceId: playbackId,
      ...(bvid !== '' ? { bvid } : {}),
      ...(page != null ? { page } : {}),
      ...(bvid !== '' && page != null
        ? { pageUrl: `https://www.bilibili.com/video/${bvid}?p=${page}` }
        : {}),
    }
  }

  private bvidFromPlaybackId(playbackId: string): string {
    if (!playbackId.startsWith('bilibili:')) return ''
    const parts = playbackId.split(':')
    return parts.length >= 2 ? parts[1] : ''
  }

  private withMobilePlaylistFields(
    playlist: Record<string, unknown>,
  ): Record<string, unknown> {
    const songs = playlist['songs']
    if (!Array.isArray(songs)) return playlist
    return {
      ...playlist,
      songs: songs
        .filter((song): song is Record<string, unknown> => asRecord(song) != null)
        .map((song) => this.withMobilePlaybackFields(song)),
    }
  }

  private withLibraryPlaylistFields(
    playlist: Record<string, unknown>,
  ): Record<string, unknown> {
    const withSongs = this.withMobilePlaylistFields(playlist)
    const title = firstText(withSongs['title'], withSongs['name'])
    const subtitle = firstText(withSongs['subtitle'], withSongs['description'])
    return {
      ...withSongs,
      ...(title !== '' ? { title, name: title } : {}),
      ...(subtitle !== '' ? { subtitle, description: subtitle } : {}),
    }
  }

  private canonicalBilibiliPlaybackId(value: unknown, fallbackPage?: unknown): string {
    const text = asString(value).trim()
    if (!text.startsWith('bilibili:')) return text
    const parts = text.split(':')
    if (parts.length < 2) return text
    const bvid = parts[1]
    const page = parts.length >= 3 ? parseBilibiliPage(parts[2]) : parseBilibiliPage(fallbackPage)
    return `bilibili:${bvid}:p${page}`
  }

  private pageFromPlaybackId(playbackId: string): number | null {
    if (!playbackId.startsWith('bilibili:')) return null
    const parts = playbackId.split(':')
    if (parts.length < 3) return 1
    return parseBilibiliPage(parts[2])
  }

  // ---- 远端 HTTP（等价 Dart 内嵌 LibraryService 的 getLibrary/saveLibrary） ----

  /** GET /library → {library: {...}} */
  private async getRemoteLibrary(): Promise<RemoteLibrary> {
    const json = await this.apiRequest('GET', '/library')
    return remoteLibraryFromJson(asRecord(json['library']) ?? {})
  }

  /** PUT /library，body {likedSongs, userPlaylists, themeMode} */
  private async saveRemoteLibrary(candidate: RemoteLibrary): Promise<RemoteLibrary> {
    const json = await this.apiRequest('PUT', '/library', {
      likedSongs: candidate.likedSongs,
      userPlaylists: candidate.userPlaylists,
      themeMode: candidate.themeMode,
    })
    return remoteLibraryFromJson(asRecord(json['library']) ?? {})
  }

  private async apiRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const token = this.tokenProvider()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        ...(body != null ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      })
      const text = await response.text()
      if (response.status === 401) {
        this.onAuthExpired?.()
      }
      if (!response.ok) {
        throw new ApiError(response.status, text)
      }
      if (text === '') return {}
      const parsed: unknown = JSON.parse(text)
      return asRecord(parsed) ?? {}
    } finally {
      clearTimeout(timer)
    }
  }
}
