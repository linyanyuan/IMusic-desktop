/**
 * 混合 provider —— 移植自 lib/services/hybrid_music_provider.dart。
 *
 * 协调：
 * - 元数据（歌词/歌曲信息）：Meting → Default（FallbackMusicProvider）
 * - 播放地址：Bilibili
 * - 单曲 tab 优先 GDStudio 直链，失败回退 B 站按标题匹配
 * - ChKSz 网易云（搜索源选择器 + 直链），缺 key/业务错误必须上抛
 */

import type { MusicProvider, RawSong, PlaylistSummary } from './musicProvider'
import { isPlaylistSummaryProvider } from './musicProvider'
import type { PlaybackUrl } from './models'
import { playbackUrl } from './models'
import { raceWithTimeout } from './fallback'
import {
  extractQuotedSongTitles,
  combineCollectionLyrics,
  type CollectionLyricSegment,
} from './collectionLyrics'
import { GdStudioMusicClient } from './gdstudio'
import {
  NeteasePublicClient,
  interleaveSongs,
  type CategoryPlaylistOptions,
} from './netease'
import { neteaseCatsForGenreKeys } from '../state/genres'
import type { ChkszMusicProvider } from './chksz'
import {
  ChkszMusicClient,
  ChkszApiKeyMissingError,
  ChkszApiError,
  type ChkszResolver,
} from './chksz'

const HARD_INSTRUMENTAL_MARKERS = [
  '伴奏',
  '纯音乐',
  '背景音乐',
  'bgm',
  'instrumental',
  'karaoke',
  'off vocal',
  'offvocal',
  '无人声',
  '消音',
]

/** 「为你推荐」单页目标首数（与默认推荐 feed 的 30 首对齐） */
const PERSONALIZED_SONGS_TARGET = 30

const SOFT_DOWNGRADE_MARKERS = [
  'dance practice',
  '练习室',
  'live',
  '现场',
  '翻唱',
  'cover',
]

export class HybridMusicProvider implements MusicProvider {
  private readonly songCache = new Map<string, RawSong>()

  constructor(
    private readonly metadata: MusicProvider,
    private readonly playback: MusicProvider,
    private readonly gdStudio: GdStudioMusicClient,
    /**
     * ChKSz provider 解析器（而不是固定实例）。
     *
     * Dart 端是 Riverpod：设置页改了 key，chksz provider 会自动重建，搜索立即生效。
     * TS 端原先在 createMusicService 里一次性快照 key —— 结果是「在设置页填了 key
     * 之后必须重启应用才能搜到 ChKSz」，用户看到的就是「配置 key 后搜索没打通」。
     * 改成解析器后与 Dart 行为对齐：每次取用都按当前 key 解析（解析器内部按 key 缓存实例）。
     */
    private readonly resolveChksz: ChkszResolver,
    /** 网易云公开接口客户端（分类歌单 / 分类热门单曲 / 网易歌单详情） */
    private readonly netease: NeteasePublicClient = new NeteasePublicClient(),
  ) {}

  /** 当前 key 对应的 ChKSz provider；未配置 key 时为 null */
  private get chksz(): ChkszMusicProvider | null {
    return this.resolveChksz()
  }

  // ---------- 搜索 ----------

  async searchSongs(query: string, page = 1): Promise<RawSong[]> {
    const safePage = page < 1 ? 1 : page
    const metadataFuture = this.metadata
      .searchSongs(query, safePage)
      .catch(() => [] as RawSong[])
    const playbackFuture = this.searchPlayback(query, safePage).catch(
      () => [] as RawSong[],
    )

    const metadataEarly = await raceWithTimeout(metadataFuture, 800)

    if (metadataEarly.length > 0) {
      return this.mergeSearchResults(metadataEarly, await playbackFuture, query)
    }

    const playbackResults = await playbackFuture
    if (playbackResults.length > 0) return playbackResults

    const metadataSongs = await metadataFuture
    if (metadataSongs.length === 0) return []
    return this.mergeSearchResults(metadataSongs, [], query)
  }

  /** 单曲 tab：优先 GDStudio 直链结果，空则回退 Meting/Default */
  async searchMetadataSongs(query: string, page = 1): Promise<RawSong[]> {
    const safePage = page < 1 ? 1 : page
    try {
      const gds = await this.gdStudio.searchSongs(query, safePage)
      if (gds.length > 0) {
        console.log(`[Hybrid] 歌曲 tab 使用 GDStudio 结果: ${gds.length} page=${safePage}`)
        this.cacheSongs(gds)
        return gds
      }
      console.log(`[Hybrid] GDStudio 搜索为空，回退元数据搜索 page=${safePage}`)
    } catch (e) {
      console.log(`[Hybrid] GDStudio 搜索失败，回退元数据: ${e}`)
    }

    const results = await this.metadata
      .searchSongs(query, safePage)
      .catch(() => [] as RawSong[])
    const songs = results.filter(isSongResult).map(withBilibiliPlaybackSource)
    this.cacheSongs(songs)
    return songs
  }

  /**
   * 「B站歌单」范围。
   *
   * ⚠️ 有意偏离 Dart：Flutter 的 searchBilibiliPlaylists 只保留 playlist，这里按用户要求
   * 把主查询返回的 **B站歌曲与歌单都收进来**（选「B站歌单」时也要能搜到歌）。
   * 追加的「<query> 歌单」扩展查询仍然只收歌单，避免标题含「歌单」的歌曲混入。
   */
  async searchBilibiliPlaylists(query: string, page = 1): Promise<RawSong[]> {
    const safePage = page < 1 ? 1 : page
    const results: RawSong[] = []
    const seenIds = new Set<string>()

    const add = (item: RawSong) => {
      const id = item['id']?.toString() ?? ''
      if (id === '' || seenIds.has(id)) return
      seenIds.add(id)
      results.push(withSourceLabel(item))
    }

    /** 主查询：歌曲与歌单都收（有意偏离 Dart，见上方 doc 注释） */
    const addSongsAndPlaylists = (items: RawSong[]) => {
      for (const item of items) add(item)
    }

    /** 追加的「<query> 歌单」扩展：只补歌单，避免标题含「歌单」的歌曲混入 */
    const addPlaylists = (items: RawSong[]) => {
      for (const item of items) {
        if (item['resultType']?.toString() !== 'playlist') continue
        add(item)
      }
    }

    try {
      addSongsAndPlaylists(await this.searchPlayback(query, safePage))
    } catch {
      /* ignore */
    }

    // 仅第一页扩展 "歌单" 后缀，避免重复集合
    if (safePage === 1 && (!looksLikePlaylistQuery(query) || results.length === 0)) {
      try {
        addPlaylists(await this.searchPlayback(`${query} 歌单`, 1))
      } catch {
        /* ignore */
      }
    }

    return results
  }

  async searchChkszSongs(query: string, page = 1): Promise<RawSong[]> {
    if (this.chksz == null) {
      throw new ChkszApiKeyMissingError('ChKSz 未启用')
    }
    const results = await this.chksz.searchSongs(query, page)
    this.cacheSongs(results)
    return results
  }

  private async searchPlayback(query: string, page = 1): Promise<RawSong[]> {
    const songs = await this.playback.searchSongs(query, page)
    return songs.map((song) => ({
      ...song,
      sourceLabel: hasUsefulText(song['sourceLabel']) ? song['sourceLabel'] : 'B站',
    }))
  }

  private async mergeSearchResults(
    metadataSongs: RawSong[],
    playbackResults: RawSong[],
    query: string,
  ): Promise<RawSong[]> {
    const results: RawSong[] = []
    const seenIds = new Set<string>()

    const addResult = (item: RawSong) => {
      const id = item['id']?.toString() ?? ''
      if (id === '' || seenIds.has(id)) return
      seenIds.add(id)
      results.push(item)
    }

    const mapped = metadataSongs.map(withBilibiliPlaybackSource)
    this.cacheSongs(mapped)
    for (const song of mapped) addResult(song)

    for (const item of playbackResults) {
      if (item['resultType']?.toString() === 'playlist') addResult(item)
    }

    if (looksLikePlaylistQuery(query)) return results

    try {
      const playlistResults = await this.searchPlayback(`${query} 歌单`)
      for (const item of playlistResults) {
        if (item['resultType']?.toString() === 'playlist') addResult(item)
      }
    } catch {
      /* ignore */
    }

    return results
  }

  // ---------- 推荐/热门 ----------

  async getRecommendedSongs(page = 1): Promise<RawSong[]> {
    const metadataFuture = this.metadata.getRecommendedSongs(page).catch(() => [] as RawSong[])
    const playbackFuture = this.playback.getRecommendedSongs(page).catch(() => [] as RawSong[])

    const metadataEarly = await raceWithTimeout(metadataFuture, 180)
    if (metadataEarly.length > 0) {
      const mapped = metadataEarly.map(withBilibiliPlaybackSource)
      this.cacheSongs(mapped)
      return mapped
    }

    const playbackSongs = await playbackFuture
    if (playbackSongs.length > 0) return playbackSongs.map(withSourceLabel)

    const metadataSongs = await metadataFuture
    const mapped = metadataSongs.map(withBilibiliPlaybackSource)
    this.cacheSongs(mapped)
    return mapped
  }

  /**
   * 分类热门歌单（网易云公开接口）—— 搜索页「热门分类」与分类详情页使用。
   * 失败/空由调用方决定展示（页面层有重试按钮）。
   */
  getCategoryPlaylists(
    cat: string,
    opts?: CategoryPlaylistOptions,
  ): Promise<RawSong[]> {
    return this.netease.getCategoryPlaylists(cat, opts)
  }

  /** 分类热门单曲：取该分类第 page 批热门歌单的曲目交错去重（约 30 首） */
  async getCategorySongs(cat: string, page = 1): Promise<RawSong[]> {
    const songs = await this.netease.getCategorySongs(cat, page)
    this.cacheSongs(songs)
    return songs
  }

  /**
   * 按用户口味偏好的个性化推荐：对每个已选分类取同一页的「分类热门单曲」，
   * 按分类轮询交错、去重后取 30 首；全部为空/失败时回退默认推荐 feed。
   */
  async getPersonalizedSongs(genreKeys: string[], page = 1): Promise<RawSong[]> {
    const cats = neteaseCatsForGenreKeys(genreKeys)
    if (cats.length > 0) {
      const lists = await Promise.all(
        cats.map((cat) =>
          this.netease.getCategorySongs(cat, page).catch(() => [] as RawSong[]),
        ),
      )
      const merged = interleaveSongs(lists, PERSONALIZED_SONGS_TARGET)
      if (merged.length > 0) {
        this.cacheSongs(merged)
        return merged
      }
      console.log('[Hybrid] 个性化推荐为空，回退默认推荐 feed')
    }
    return this.getRecommendedSongs(page)
  }

  async getHotPlaylists(opts?: { limit?: number; offset?: number }): Promise<RawSong[]> {
    const metadataFuture = this.metadata.getHotPlaylists(opts).catch(() => [] as RawSong[])
    const playbackFuture = this.playback.getHotPlaylists(opts).catch(() => [] as RawSong[])

    const metadataFirst = await raceWithTimeout(metadataFuture, 180)
    if (metadataFirst.length > 0) return metadataFirst.map(withSourceLabel)

    const playbackPlaylists = await playbackFuture
    if (playbackPlaylists.length > 0) return playbackPlaylists.map(withSourceLabel)

    const metadataPlaylists = await metadataFuture
    return metadataPlaylists.map(withSourceLabel)
  }

  // ---------- 歌单/详情 ----------

  async getPlaylist(id: string, limit?: number): Promise<RawSong> {
    // 网易云公开歌单（分类浏览/首页进入）：id 形如 `netease-playlist:<id>`
    if (NeteasePublicClient.isNeteasePlaylistId(id)) {
      const playlist = await this.netease.getPlaylist(id, limit)
      this.cachePlaylistSongs(playlist)
      return playlist
    }
    if (ChkszMusicClient.isChkszPlaylistId(id)) {
      if (this.chksz == null) throw new Error('ChKSz 未启用')
      const playlist = await this.chksz.getPlaylist(id, limit)
      this.cachePlaylistSongs(playlist)
      return playlist
    }
    const playlist = isMetingCollectionId(id)
      ? await this.metadata.getPlaylist(id, limit)
      : await this.playback.getPlaylist(id, limit)
    this.cachePlaylistSongs(playlist)
    return playlist
  }

  getPlaylistSummary(playlist: RawSong): Promise<PlaylistSummary> {
    if (isPlaylistSummaryProvider(this.playback)) {
      return this.playback.getPlaylistSummary(playlist)
    }
    return Promise.resolve({ available: false, songCount: 0, durationSeconds: 0 })
  }

  async resolvePlaybackId(song: RawSong): Promise<string> {
    const id = song['id']?.toString().trim() ?? ''
    const playbackId = song['playbackId']?.toString().trim() ?? ''
    if (playbackId.startsWith('bilibili:')) {
      return canonicalBilibiliPlaybackId(playbackId)
    }
    if (!isMetingId(id)) return canonicalBilibiliPlaybackId(id)

    const cached = this.songCache.get(id)
    const metadataSong = cached == null ? song : { ...cached, ...song }
    return this.resolveBilibiliPlaybackId(metadataSong)
  }

  async getSongDetail(id: string): Promise<RawSong> {
    if (ChkszMusicClient.isChkszId(id)) {
      return (await this.chksz?.getSongDetail(id)) ?? { id }
    }
    if (!isMetingId(id)) return this.playback.getSongDetail(id)
    const detail = await this.metadata.getSongDetail(id)
    return this.mergeCachedDetail(id, detail)
  }

  // ---------- 取链 ----------

  async getPlayUrl(id: string): Promise<PlaybackUrl> {
    // GDStudio 单曲：直链优先，失败回退 B 站按标题
    if (GdStudioMusicClient.isGdStudioId(id)) {
      try {
        const direct = await this.gdStudio.getPlayUrl(id)
        if (direct.url.trim() !== '') {
          console.log(`[Hybrid] GDStudio 直链播放: ${id}`)
          void this.ensureGdStudioCover(id) // 封面不阻塞播放
          return direct
        }
      } catch (e) {
        console.log(`[Hybrid] GDStudio 取链失败，回退 B 站: ${e}`)
      }
      const cached = this.songCache.get(id) ?? { id }
      try {
        const resolvedId = await this.resolveBilibiliPlaybackId(cached)
        const playUrl = await this.playback.getPlayUrl(resolvedId)
        return playbackUrl(playUrl.url, {
          headers: playUrl.headers,
          lyrics: playUrl.lyrics,
          resolvedId,
        })
      } catch (e) {
        throw new Error(`无法获取播放地址: ${e}`)
      }
    }

    // ChKSz 网易云：直链优先；缺 key/业务错误上抛，绝不回落 B 站
    if (ChkszMusicClient.isChkszId(id)) {
      if (!ChkszMusicClient.isChkszSongId(id)) {
        throw new Error(`ChKSz 歌单不能直接播放: ${id}`)
      }
      if (this.chksz == null) throw new Error('ChKSz 未启用')
      try {
        const direct = await this.chksz.getPlayUrl(id)
        if (direct.url.trim() !== '') {
          console.log(`[Hybrid] ChKSz 直链播放: ${id}`)
          return direct
        }
      } catch (e) {
        if (e instanceof ChkszApiKeyMissingError || e instanceof ChkszApiError) {
          throw e
        }
        console.log(`[Hybrid] ChKSz 取链失败，回退 B 站: ${e}`)
      }
      const cached = this.songCache.get(id) ?? { id }
      try {
        const resolvedId = await withTimeout(
          this.resolveBilibiliPlaybackId(cached),
          ChkszMusicClient.fallbackTimeout,
        )
        const playUrl = await this.playback.getPlayUrl(resolvedId)
        return playbackUrl(playUrl.url, {
          headers: playUrl.headers,
          lyrics: playUrl.lyrics,
          resolvedId,
          // B 站回退时透传 ChKSz 搜索行封面
          coverUrl: cached['coverUrl']?.toString().trim() ?? '',
        })
      } catch (e) {
        throw new Error(`无法获取播放地址: ${e}`)
      }
    }

    // 纯 B 站歌曲
    if (!isMetingId(id)) {
      const playUrl = await this.playback.getPlayUrl(id)
      return playbackUrl(playUrl.url, {
        headers: playUrl.headers,
        lyrics: playUrl.lyrics,
        resolvedId: playUrl.resolvedId,
      })
    }

    // Meting 歌曲：先详情 → 稳定 playbackId → 搜索
    try {
      const cached = this.songCache.get(id)
      const existingPlaybackId = cached?.['playbackId']?.toString().trim() ?? ''
      let detail: RawSong
      if (existingPlaybackId !== '') {
        detail = cached != null
          ? this.mergeCachedDetail(id, cached)
          : this.mergeCachedDetail(id, await this.metadata.getSongDetail(id))
      } else {
        detail = this.mergeCachedDetail(id, await this.metadata.getSongDetail(id))
      }
      const detailPlaybackId = detail['playbackId']?.toString().trim() ?? ''
      let resolvedId = detailPlaybackId
      if (resolvedId === '') resolvedId = existingPlaybackId
      if (resolvedId === '') resolvedId = await this.resolveBilibiliPlaybackId(detail)
      const playUrl = await this.playback.getPlayUrl(resolvedId)
      const lyrics = detail['lyrics']?.toString() ?? ''
      return playbackUrl(playUrl.url, {
        headers: playUrl.headers,
        lyrics: lyrics !== '' ? lyrics : playUrl.lyrics,
        resolvedId,
        coverUrl: detail['coverUrl']?.toString().trim() ?? '',
      })
    } catch (e) {
      throw new Error(`无法获取播放地址: ${e}`)
    }
  }

  // ---------- 歌词 ----------

  rememberSongs(songs: RawSong[]): void {
    this.cacheSongs(songs)
  }

  async getLyrics(song: RawSong): Promise<string> {
    const existing = song['lyrics']?.toString().trim() ?? ''
    if (existing !== '') return existing

    const id = song['id']?.toString() ?? ''

    if (ChkszMusicClient.isChkszId(id)) {
      return (await this.chksz?.getLyrics?.(song)) ?? ''
    }

    if (GdStudioMusicClient.isGdStudioId(id)) {
      const parsed = GdStudioMusicClient.parseSongId(id)
      if (parsed == null) return ''
      const [source, mediaId] = parsed
      const lyricIdRaw = song['lyric_id']?.toString().trim()
      const lyricId = lyricIdRaw != null && lyricIdRaw !== '' ? lyricIdRaw : mediaId
      try {
        return await this.gdStudio.getLyric({ source, lyricId })
      } catch {
        return ''
      }
    }

    if (isMetingId(id)) {
      const detail = this.mergeCachedDetail(id, await this.metadata.getSongDetail(id))
      this.cacheSongs([detail])
      return detail['lyrics']?.toString().trim() ?? ''
    }

    // B 站歌曲：先 CC 字幕，再反查元数据
    const directLyrics = await (this.playback.getLyrics?.(song) ?? Promise.resolve('')).catch(
      () => '',
    )
    if (directLyrics.trim() !== '') return directLyrics.trim()

    const quotedTitles = extractQuotedSongTitles(song['title']?.toString() ?? '')
    if (quotedTitles.length > 1) {
      const collectionLyrics = await this.collectionLyricsForTitles(song, quotedTitles)
      if (collectionLyrics.trim() !== '') return collectionLyrics
    }

    const playbackId = song['playbackId']?.toString() ?? id
    if (playbackId === '') return ''
    this.cacheSongs([song])
    return this.metadataLyricsForPlaybackSong(playbackId)
  }

  private async collectionLyricsForTitles(
    song: RawSong,
    titles: string[],
  ): Promise<string> {
    const artist = song['artist']?.toString().trim() ?? ''
    const segments: CollectionLyricSegment[] = []

    for (const title of titles) {
      const candidates = await this.metadata
        .searchSongs(title)
        .catch(() => [] as RawSong[])
      const best =
        bestMetadataMatch({ title, artist, duration: 0 }, candidates) ??
        candidates.find((item) => item['resultType']?.toString() !== 'playlist') ??
        null

      const bestId = best?.['id']?.toString() ?? ''
      if (bestId === '') {
        segments.push({ title, lyrics: '' })
        continue
      }

      const detail = this.mergeCachedDetail(
        bestId,
        await this.metadata.getSongDetail(bestId),
      )
      this.cacheSongs([detail])
      segments.push({ title, lyrics: detail['lyrics']?.toString().trim() ?? '' })
    }

    return combineCollectionLyrics(segments, durationOf(song))
  }

  /** B 站歌曲反查元数据歌词 */
  private async metadataLyricsForPlaybackSong(id: string): Promise<string> {
    const cached = this.songCache.get(id)
    const song =
      cached ??
      (await this.playback.getSongDetail(id).catch(() => ({ id }) as RawSong))
    const cachedLyrics = song['lyrics']?.toString().trim() ?? ''
    if (cachedLyrics !== '') return cachedLyrics

    const candidates = await this.searchMetadataForSong(song)
    const best = bestMetadataMatch(song, candidates)
    const metadataId = best?.['id']?.toString() ?? ''
    if (metadataId === '') return ''

    const detail = this.mergeCachedDetail(
      metadataId,
      await this.metadata.getSongDetail(metadataId),
    )
    this.cacheSongs([detail])
    return detail['lyrics']?.toString().trim() ?? ''
  }

  private async searchMetadataForSong(song: RawSong): Promise<RawSong[]> {
    const titleCandidates = metadataTitleCandidates(song['title'])
    const artist = song['artist']?.toString().trim() ?? ''
    const useArtist = !isLikelyBilibiliSource(song)
    const queries = new Set<string>()

    for (const title of titleCandidates) {
      if (useArtist) {
        queries.add([artist, title].filter((s) => s !== '').join(' '))
      }
      queries.add(title)
    }

    const allResults: RawSong[] = []
    const seenIds = new Set<string>()

    for (const query of queries) {
      if (query.trim() === '') continue
      const results = await this.metadata
        .searchSongs(query)
        .catch(() => [] as RawSong[])
      for (const result of results) {
        const id = result['id']?.toString() ?? ''
        if (id === '' || seenIds.has(id)) continue
        seenIds.add(id)
        allResults.push(result)
      }
      if (bestMetadataMatch(song, allResults) != null) return allResults
    }
    return allResults
  }

  private async resolveBilibiliPlaybackId(song: RawSong): Promise<string> {
    const title = song['title']?.toString() ?? ''
    const artist = song['artist']?.toString() ?? ''
    const queries = [
      [artist, title].filter((s) => s.trim() !== '').join(' '),
      title,
    ].filter((q) => q.trim() !== '')
    const uniqueQueries = [...new Set(queries)]

    for (const query of uniqueQueries) {
      const candidates = await this.playback.searchSongs(query)
      const best = bestBilibiliMatch(song, candidates)
      const id = best?.['id']?.toString() ?? ''
      if (id !== '') return id
    }
    throw new Error('未找到可播放的 B站版本')
  }

  // ---------- 缓存/封面 ----------

  private cachePlaylistSongs(playlist: RawSong): void {
    const songs = playlist['songs']
    if (Array.isArray(songs)) {
      this.cacheSongs(songs.filter((s) => s != null && typeof s === 'object') as RawSong[])
    }
  }

  private cacheSongs(songs: RawSong[]): void {
    for (const song of songs) {
      const id = song['id']?.toString() ?? ''
      if (id !== '') this.songCache.set(id, song)
    }
  }

  /** GDStudio 歌曲缺封面时异步补齐（不阻塞播放） */
  private async ensureGdStudioCover(id: string): Promise<void> {
    const cached = this.songCache.get(id)
    if (cached == null) return
    const existing = cached['coverUrl']?.toString().trim() ?? ''
    if (existing !== '') return

    const source = cached['gdstudioSource']?.toString().trim() ?? ''
    const picId = cached['pic_id']?.toString().trim() ?? ''
    if (source === '' || picId === '') return

    const hinted = GdStudioMusicClient.coverUrlHint({ source, picId })
    if (hinted != null && hinted !== '') {
      this.songCache.set(id, { ...cached, coverUrl: hinted })
      return
    }

    try {
      const url = await this.gdStudio.getPicUrl({ source, picId, size: 300 })
      if (url != null && url !== '') {
        this.songCache.set(id, { ...cached, coverUrl: url })
      }
    } catch {
      /* ignore */
    }
  }

  private mergeCachedDetail(id: string, detail: RawSong): RawSong {
    const cached = this.songCache.get(id)
    if (cached == null) return detail
    const merged: RawSong = { ...detail }
    if (!hasUsefulText(detail['title'], '未知歌曲')) merged['title'] = cached['title']
    if (!hasUsefulText(detail['artist'], '未知艺人')) merged['artist'] = cached['artist']
    if (!hasUsefulText(detail['album'])) merged['album'] = cached['album']
    if (!hasUsefulText(detail['coverUrl'])) merged['coverUrl'] = cached['coverUrl']
    if (!hasUsefulDuration(detail)) merged['duration'] = cached['duration']
    if (!hasUsefulText(detail['playbackId'])) merged['playbackId'] = cached['playbackId']
    if (!hasUsefulText(detail['lyrics'])) merged['lyrics'] = cached['lyrics']
    if (!hasUsefulText(detail['sourceLabel'])) merged['sourceLabel'] = cached['sourceLabel']
    if (!hasUsefulText(detail['playbackSourceLabel']))
      merged['playbackSourceLabel'] = cached['playbackSourceLabel']
    return merged
  }
}

// ================= 匹配/清洗（静态工具） =================

export function bestMetadataMatch(
  target: RawSong,
  candidates: RawSong[],
): RawSong | null {
  let bestScore = -1
  let best: RawSong | null = null
  for (const candidate of candidates) {
    if (candidate['resultType']?.toString() === 'playlist') continue
    const score = matchScore(target, candidate)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return bestScore <= 0 ? null : best
}

export function bestBilibiliMatch(
  target: RawSong,
  candidates: RawSong[],
): RawSong | null {
  let bestScore = -1
  let best: RawSong | null = null
  const targetTitle = target['title']?.toString() ?? ''
  for (const candidate of candidates) {
    if (candidate['resultType']?.toString() === 'playlist') continue
    const candidateTitle = candidate['title']?.toString() ?? ''
    if (isHardExcludedInstrumental(targetTitle, candidateTitle)) continue
    const score = matchScore(target, candidate)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return bestScore <= 0 ? null : best
}

/** 目标不是纯音乐时，硬排除伴奏/纯音乐候选 */
function isHardExcludedInstrumental(
  targetTitle: string,
  candidateTitle: string,
): boolean {
  if (containsAnyMarker(targetTitle, HARD_INSTRUMENTAL_MARKERS)) return false
  return containsAnyMarker(candidateTitle, HARD_INSTRUMENTAL_MARKERS)
}

function containsAnyMarker(text: string, markers: string[]): boolean {
  const normalized = text.toLowerCase()
  return markers.some((m) => normalized.includes(m.toLowerCase()))
}

function withBilibiliPlaybackSource(song: RawSong): RawSong {
  return { ...song, playbackSource: 'bilibili', playbackSourceLabel: 'B站' }
}

function withSourceLabel(item: RawSong): RawSong {
  const sourceLabel = item['sourceLabel']?.toString().trim() ?? ''
  if (sourceLabel !== '') return item
  return { ...item, sourceLabel: sourceLabelFor(item['source']?.toString() ?? '') }
}

export function matchScore(target: RawSong, candidate: RawSong): number {
  const targetTitle = normalized(target['title'])
  const targetArtist = normalized(target['artist'])
  const candidateTitle = normalized(candidate['title'])
  const candidateArtist = normalized(candidate['artist'])
  let score = 0

  if (targetTitle !== '' && candidateTitle.includes(targetTitle)) score += 60
  if (targetTitle !== '' && targetTitle.includes(candidateTitle)) score += 55

  if (
    targetArtist !== '' &&
    (candidateTitle.includes(targetArtist) || candidateArtist.includes(targetArtist))
  ) {
    score += 24
  }

  const durationDelta = Math.abs(durationOf(target) - durationOf(candidate))
  if (durationDelta <= 5000) {
    score += 20
  } else if (durationDelta <= 45000) {
    score += 10
  } else if (durationOf(target) > 0 && durationOf(candidate) > durationOf(target) * 2) {
    score -= 70
  }

  if (/(合集|歌单|playlist)/i.test(candidate['title']?.toString() ?? '')) score -= 18
  if (containsAnyMarker(candidate['title']?.toString() ?? '', SOFT_DOWNGRADE_MARKERS)) {
    score -= 18
  }
  return score
}

function isMetingId(id: string): boolean {
  return id.startsWith('meting:')
}

function isMetingCollectionId(id: string): boolean {
  return id.startsWith('meting-artist:') || id.startsWith('meting-playlist:')
}

function isLikelyBilibiliSource(song: RawSong): boolean {
  const id = song['id']?.toString() ?? ''
  const source = song['source']?.toString() ?? ''
  return id.startsWith('bilibili:') || source.includes('bilibili')
}

function looksLikePlaylistQuery(query: string): boolean {
  const n = normalized(query)
  return n.includes('歌单') || n.includes('合集') || n.includes('playlist')
}

function sourceLabelFor(source: string): string {
  if (source.includes('tencent') || source.includes('qqmusic')) return '腾讯音乐'
  if (source.includes('kugou')) return '酷狗音乐'
  if (source.includes('bilibili')) return 'B站'
  return source === '' ? '' : source
}

function hasUsefulText(value: unknown, placeholder = ''): boolean {
  const text = value?.toString().trim() ?? ''
  return text !== '' && (placeholder === '' || text !== placeholder)
}

function hasUsefulDuration(song: RawSong): boolean {
  const d = durationOf(song)
  return d > 0 && d < 12 * 3600 * 1000
}

export function cleanSearchTitle(value: unknown): string {
  return (
    value
      ?.toString()
      .replace(/<[^>]+>/g, '')
      .replace(/【[^】]*】/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/〈[^〉]*〉/g, ' ')
      .replace(/「[^」]*」/g, ' ')
      .replace(/『[^』]*』/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/（[^）]*）/g, ' ')
      .replace(/\{[^}]*\}/g, ' ')
      .replace(
        /(官方|完整版|歌词版?|高音质|无损音质|高品质|HQ|HiFi|Hi-Res|现场版?|live|mv|cover|翻唱|伴奏|remix|重制|混音|纯音乐|背景音乐|BGM|bgm|单人|独奏|乐器|钢琴|吉他|古筝|二胡|小提琴|循环|单曲循环|合集|歌单|精选|串烧|盘点|超清|高清|4k|8k|60fps|60帧|画质|修复|收藏级|我是歌手|中国好声音|歌手|蒙面唱将|动态歌词|滚动歌词|歌词版?|字幕|CC字幕|竖屏|横屏|可视化|推荐|热门|新歌|经典|怀旧|伤感|治愈|车载|驾驶|跑步|运动|学习|工作|好听|循环播放|单曲|神曲|片段|节选|精华|完整|全长)/gi,
        ' ',
      )
      .replace(/[・·•]/g, ' ')
      .replace(/[｜|/\\]+/g, ' ')
      .replace(/\s*[-—–]+\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() ?? ''
  )
}

export function metadataTitleCandidates(value: unknown): string[] {
  const raw = value?.toString() ?? ''
  const candidates: string[] = []

  const add = (item: string) => {
    const cleaned = cleanSearchTitle(item)
    const n = normalized(cleaned)
    if (n === '' || n.length < 2) return
    if (/^(gem|邓紫棋|周杰伦|林俊杰|张杰|周深)$/i.test(cleaned.trim())) return
    if (!candidates.some((existing) => normalized(existing) === n)) {
      candidates.push(cleaned)
    }
  }

  for (const part of raw.split(/[｜|/\\]+/)) add(part)
  for (const part of raw.split(/\s+-\s+|\s+—\s+|\s+_\s+/)) add(part)
  add(raw)

  candidates.sort((a, b) => normalized(a).length - normalized(b).length)
  return candidates
}

function normalized(value: unknown): string {
  return (
    value
      ?.toString()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^一-龥a-z0-9]/g, '') ?? ''
  )
}

export function durationOf(song: RawSong): number {
  const value = song['duration']
  if (typeof value === 'number') return Math.round(value)
  return Number.parseInt(value?.toString() ?? '', 10) || 0
}

export function canonicalBilibiliPlaybackId(id: string): string {
  if (!id.startsWith('bilibili:')) return id
  const parts = id.split(':')
  if (parts.length < 2) return id
  const pageText = parts.length > 2 ? parts[2] : '1'
  const page = Number.parseInt(pageText.replace(/^[pP]/, ''), 10) || 1
  return `bilibili:${parts[1]}:p${page < 1 ? 1 : page}`
}

function isSongResult(item: RawSong): boolean {
  const type = item['resultType']?.toString().trim() ?? ''
  return type === '' || type === 'song'
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ])
}
