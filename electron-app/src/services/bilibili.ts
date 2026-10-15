/**
 * Bilibili 音乐 provider —— 移植自 lib/services/bilibili_music_provider.dart。
 * 提供 B 站搜索与播放地址；实现 PlaylistSummaryProvider（歌单概要）。
 *
 * HTTP 用全局 fetch + AbortController 超时（对应 Dart dio 的 connect/receive
 * timeout 及 `.timeout()` 包装）。Dart 端没有 WBI 签名或 buvid cookie 逻辑，
 * 此处同样不涉及。
 */

import type {
  MusicProvider,
  PlaylistSummary,
  PlaylistSummaryKind,
  PlaylistSummaryProvider,
  RawSong,
} from './musicProvider'
import { UNAVAILABLE_PLAYLIST_SUMMARY } from './musicProvider'
import type { PlaybackUrl } from './models'
import { playbackUrl } from './models'
import { extractQuotedSongTitles } from './collectionLyrics'

const API_BASE = 'https://api.bilibili.com'
const GATEWAY_BASE = 'https://gateway.karpov.cn/api/proxy'

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Origin: 'https://www.bilibili.com',
  Referer: 'https://www.bilibili.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * search/type 的结果会混入无 bvid 的条目（type=ketang 课堂/付费课程、番剧、影视），
 * 这些条目仅凭 bvid 无法取流，必须在映射前剔除，否则会生成 `bilibili:` 这种空 id 流入 UI 与播放链路。
 */
/** B站图片 URL 归一化：`//` 与 `http://` 都升到 `https://`。
 * 渲染层 CSP 的 img-src 只放 https（http 图会被拒，表现为封面全空）。 */
function normalizeBilibiliImageUrl(url: string): string {
  const text = url.trim()
  if (text.startsWith('//')) return `https:${text}`
  if (text.startsWith('http://')) return `https://${text.slice('http://'.length)}`
  return text
}

/**
 * 热门歌单「换一批」的搜索主题池 —— 按批次轮换关键词，
 * 同一关键词连翻几页内容雷同，轮换主题保证每批都是不同风格；
 * 每个主题内部再翻页（page = 轮数 + 1）。
 */
const HOT_PLAYLIST_KEYWORDS = [
  '音乐合集',
  '歌单精选',
  '华语经典合集',
  '抖音热歌合集',
  '车载音乐合集',
  '欧美音乐精选',
  '纯音乐合集',
  '粤语经典合集',
  '摇滚精选合集',
  '影视原声合集',
] as const

/** 批次 → { keyword, page }；导出以便单测锁定轮换语义 */
export function hotPlaylistQueryForBatch(batch: number): { keyword: string; page: number } {
  const safeBatch = Math.max(0, Math.floor(batch))
  return {
    keyword: HOT_PLAYLIST_KEYWORDS[safeBatch % HOT_PLAYLIST_KEYWORDS.length] as string,
    page: Math.floor(safeBatch / HOT_PLAYLIST_KEYWORDS.length) + 1,
  }
}

function hasPlayableBvid(item: Record<string, unknown>): boolean {
  return (item['bvid']?.toString() ?? '').trim() !== ''
}

// === B 站媒体地址挑选 ===
//
// playurl 对每个音频流会给出 3 个候选：
//   1. `*.mcdn.bilivideo.cn:8082`（PCDN）
//   2. `*.edge.<pcdn 镜像域名>:4483`（同样是 PCDN，域名不固定）
//   3. `upos-*.bilivideo.com`（标准 CDN，真正可靠的那个）
//
// PCDN 靠客户端互相上传，端口不是 443，很多网络（公司网/代理上网）连不上：
// 症状是 `audio.readyState` 永远是 0、20s 后元数据超时、连重试 2 次都失败，
// 用户看到的是一句「播放失败（已重试 2 次）」。所以必须先挑标准 CDN。
//
// 此前只过滤了 `mcdn.bilivideo` 字面量，于是第 2 类 PCDN 镜像（域名各异，
// 如 `*.edge.mountaintoys.cn`）会被当成“非 PCDN”而优先选中 —— 这就是合集里的
// 歌一点就播放失败的原因。

/** 已知 PCDN 镜像域名后缀（不固定，按需补充） */
const PCDN_HOST_SUFFIXES = ['mountaintoys.cn', 'szbdyd.com', 'pcdn.bilivideo.com']

/** B 站标准 CDN（可靠、走 443） */
const STANDARD_CDN_SUFFIXES = ['bilivideo.com', 'bilivideo.cn', 'akamaized.net', 'hdslb.com']

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** 是否是 PCDN 地址（按端口 / os=mcdn / 已知镜像域名判定） */
export function isPcdnMediaUrl(raw: string): boolean {
  const host = hostOf(raw)
  if (host === '') return false
  if (host.includes('mcdn')) return true
  if (PCDN_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    return true
  }
  try {
    const url = new URL(raw)
    if (url.port === '4483' || url.port === '8082') return true
    if ((url.searchParams.get('os') ?? '').toLowerCase() === 'mcdn') return true
  } catch {
    /* 上面 hostOf 已经判过可解析性 */
  }
  return false
}

/**
 * 从候选里挑最可能可播的那个：标准 CDN > 其他非 PCDN > PCDN（挖到底也不空手）。
 */
export function pickBestMediaUrl(urls: readonly string[]): string | null {
  const valid = urls.map((u) => u.trim()).filter((u) => u !== '')
  if (valid.length === 0) return null

  const isStandard = (u: string) => {
    const host = hostOf(u)
    return host !== '' && STANDARD_CDN_SUFFIXES.some((s) => host.endsWith(s))
  }

  return (
    valid.find((u) => isStandard(u) && !isPcdnMediaUrl(u)) ??
    valid.find((u) => !isPcdnMediaUrl(u)) ??
    valid[0]
  )
}

export interface BilibiliMusicProviderOptions {
  /** 推荐（Gateway）请求整体超时，毫秒；默认 3s */
  recommendationTimeout?: number
}

/** B 站音乐 provider：播放地址 + 搜索 */
export class BilibiliMusicProvider
  implements MusicProvider, PlaylistSummaryProvider
{
  /** api.bilibili.com 请求超时（对应 dio connect/receive 15s） */
  static readonly requestTimeout = 15000

  private readonly recommendationTimeout: number
  private readonly cidByPlaybackId = new Map<string, string>()

  constructor(options: BilibiliMusicProviderOptions = {}) {
    this.recommendationTimeout = options.recommendationTimeout ?? 3000
  }

  rememberSongs(_songs: RawSong[]): void {
    // Bilibili provider 空实现 —— 缓存由 MusicService 处理
  }

  async searchSongs(query: string, page = 1): Promise<RawSong[]> {
    if (query.trim() === '') return []
    const safePage = page < 1 ? 1 : page

    try {
      console.log(
        `[BilibiliMusicProvider] searchSongs - 查询: ${query} page=${safePage}`,
      )
      const json = await this.apiGet('/x/web-interface/wbi/search/type', {
        search_type: 'video',
        keyword: query,
        page: safePage,
      })

      console.log('[BilibiliMusicProvider] searchSongs - 请求完成')
      const data = json?.['data']
      const result = isRecord(data) ? data['result'] : null
      const resultList = Array.isArray(result) ? result : null
      console.log(
        `[BilibiliMusicProvider] searchSongs - 结果数量: ${resultList?.length ?? 0}`,
      )
      if (resultList == null) return []

      const records = resultList.filter(isRecord)
      const playable = records.filter(hasPlayableBvid)
      const skipped = records.length - playable.length
      if (skipped > 0) {
        console.log(
          `[BilibiliMusicProvider] searchSongs - 过滤无 bvid 条目: ${skipped}`,
        )
      }

      const songs = playable.map((item) => {
        const bvid = item['bvid']?.toString() ?? ''
        const title = stripHtmlTags(item['title']?.toString() ?? '未知标题')
        const author = item['author']?.toString() ?? '未知UP主'
        const duration = parseDurationSeconds(item['duration'])
        const pic = item['pic']?.toString() ?? ''
        const quotedTitles = extractQuotedSongTitles(title)
        const isPlaylist = looksLikeCollection(title, duration)

        return {
          id: `bilibili:${bvid}`,
          title,
          artist: author,
          source: 'bilibili',
          sourceLabel: 'B站',
          duration: duration * 1000, // 转为毫秒
          coverUrl: normalizeBilibiliImageUrl(pic),
          resultType: isPlaylist ? 'playlist' : 'song',
          songCount: isPlaylist ? quotedTitles.length : 1,
        } as RawSong
      })

      console.log(`[BilibiliMusicProvider] searchSongs - 返回歌曲: ${songs.length} 首`)
      return songs
    } catch (e) {
      console.log(`[BilibiliMusicProvider] searchSongs - 失败: ${e}`)
      return []
    }
  }

  async getRecommendedSongs(page = 1): Promise<RawSong[]> {
    console.log('[BilibiliMusicProvider] getRecommendedSongs - 开始获取推荐歌曲, page=', page)

    // 对照 BiliMusic 的 getMusicFeed：推荐 = 单曲 feed（不是歌单）。
    // 池子优先级：音乐中心综合热歌榜（真正的歌曲元数据）> Gateway 单曲 >
    // 音乐区热榜单曲（混有非歌曲稿件，只作兜底）。换一批 = page+1 取下一页。
    const songRankFuture = this.getMusicSongRank({ page, pageSize: 24 }).catch(
      () => [] as RawSong[],
    )

    let gatewaySongs: RawSong[] = []
    try {
      console.log('[BilibiliMusicProvider] 请求 Gateway API: /qqmusic/search/songs')

      const json = await this.gatewayGet(
        '/qqmusic/search/songs',
        { q: '热门', page, page_size: 30 },
        this.recommendationTimeout,
      )

      const songsRaw = json?.['songs']
      const songs = Array.isArray(songsRaw) ? songsRaw : []

      console.log(`[BilibiliMusicProvider] Gateway 返回 ${songs.length} 首歌曲`)

      gatewaySongs = songs.filter(isRecord).map((item) => ({
        id: item['id']?.toString() ?? '',
        title: item['title']?.toString() ?? '未知标题',
        artist: item['artist']?.toString() ?? '未知艺人',
        source: 'qqmusic',
        sourceLabel: 'QQ音乐',
        duration:
          typeof item['duration'] === 'number' ? (item['duration'] as number) : 0,
        coverUrl: item['coverUrl']?.toString(),
        playbackSource: 'bilibili',
        resultType: 'song',
      }))
    } catch (e) {
      console.log(`[BilibiliMusicProvider] Gateway API 失败: ${e}`)
    }

    const songRank = await songRankFuture
    if (gatewaySongs.length === 0 && songRank.length === 0) {
      // 两个主池都空才降级（音乐区热榜 → 搜索结果；搜索多为合集视频，只作最后兜底）
      console.log('[BilibiliMusicProvider] 推荐主池为空，降级音乐区热榜')
      const ranking = await this.getMusicRanking({ page, pageSize: 30 }).catch(
        () => [] as RawSong[],
      )
      if (ranking.length > 0) return ranking
      console.log('[BilibiliMusicProvider] 音乐区热榜也空，降级 Bilibili 搜索')
      return this.searchBilibiliRecommended()
    }

    // 交错混合（热歌榜优先），按 id 去重
    const mixed: RawSong[] = []
    const seen = new Set<string>()
    const push = (song: RawSong) => {
      const id = song['id']?.toString() ?? ''
      if (id === '' || seen.has(id)) return
      seen.add(id)
      mixed.push(song)
    }
    const rounds = Math.max(songRank.length, gatewaySongs.length)
    for (let i = 0; i < rounds; i++) {
      if (i < songRank.length) push(songRank[i] as RawSong)
      if (i < gatewaySongs.length) push(gatewaySongs[i] as RawSong)
    }
    return mixed.slice(0, 30)
  }

  private async searchBilibiliRecommended(): Promise<RawSong[]> {
    console.log(
      '[BilibiliMusicProvider] searchBilibiliRecommended - 使用 Bilibili 降级方案',
    )

    try {
      const json = await this.apiGet('/x/web-interface/wbi/search/type', {
        search_type: 'video',
        keyword: '热门音乐',
        page: 1,
        order: 'totalrank',
      })

      const data = json?.['data']
      const result = isRecord(data) ? data['result'] : null
      const resultList = Array.isArray(result) ? result : null
      if (resultList == null) {
        console.log('[BilibiliMusicProvider] Bilibili 搜索返回空结果')
        return []
      }

      const songs = resultList
        .filter(isRecord)
        .filter(hasPlayableBvid)
        .slice(0, 20)
        .map((item) => {
          const bvid = item['bvid']?.toString() ?? ''
          const title = stripHtmlTags(item['title']?.toString() ?? '未知标题')
          const author = item['author']?.toString() ?? '未知UP主'

          const duration = parseDurationSeconds(item['duration'])
          const pic = item['pic']?.toString() ?? ''
          const quotedTitles = extractQuotedSongTitles(title)
          const isPlaylist = looksLikeCollection(title, duration)

          return {
            id: `bilibili:${bvid}`,
            title,
            artist: author,
            source: 'bilibili',
            sourceLabel: 'B站',
            duration: duration * 1000, // 转换为毫秒
            coverUrl: normalizeBilibiliImageUrl(pic),
            resultType: isPlaylist ? 'playlist' : 'song',
            songCount: isPlaylist ? quotedTitles.length : 1,
          } as RawSong
        })

      console.log(`[BilibiliMusicProvider] Bilibili 降级返回 ${songs.length} 首歌曲`)
      return songs
    } catch (e) {
      console.log(`[BilibiliMusicProvider] Bilibili 降级也失败: ${e}`)
      return []
    }
  }

  async getHotPlaylists(opts?: {
    limit?: number
    offset?: number
  }): Promise<RawSong[]> {
    try {
      const pageSize = opts?.limit ?? 10
      const batch = Math.floor((opts?.offset ?? 0) / pageSize)
      // 换一批 = 批次 +1：按批次轮换搜索主题（同一关键词连翻几页观感雷同），
      // 每个主题内部再翻页
      const { keyword, page } = hotPlaylistQueryForBatch(batch)

      // 搜索音乐合集类视频
      const json = await this.apiGet('/x/web-interface/wbi/search/type', {
        search_type: 'video',
        keyword,
        page,
        duration: 4, // 60分钟以上的视频（更可能是合集）
      })

      const data = json?.['data']
      const result = isRecord(data) ? data['result'] : null
      const resultList = Array.isArray(result) ? result : null
      if (resultList == null) return []

      return resultList
        .filter(isRecord)
        .filter(hasPlayableBvid)
        .slice(0, opts?.limit ?? 10)
        .map((item) => {
          const bvid = item['bvid']?.toString() ?? ''
          const title = stripHtmlTags(item['title']?.toString() ?? '未知歌单')
          const author = item['author']?.toString() ?? '未知UP主'
          const pic = item['pic']?.toString() ?? ''

          return {
            id: `bilibili:${bvid}`,
            title,
            subtitle: author,
            source: 'bilibili',
            sourceLabel: 'B站',
            resultType: 'playlist',
            songCount: 0, // 需要调用 getPlaylist 才能获取实际数量
            coverUrl: normalizeBilibiliImageUrl(pic),
          } as RawSong
        })
    } catch {
      return []
    }
  }

  /**
   * 音乐中心综合热歌榜 —— 真正的歌曲元数据（曲名/歌手/专辑/封面），
   * 对照 BiliMusic 的 getMusicComprehensiveRank。无需 WBI/csrf。
   *
   * 注意：综合榜顶层的 bvid 是 music-metadata 伪 id，实际可播的稿件在
   * related_archive.bvid（BiliMusic 踩过的坑）—— 优先用它。
   */
  async getMusicSongRank(opts?: { page?: number; pageSize?: number }): Promise<RawSong[]> {
    const page = Math.max(1, Math.floor(opts?.page ?? 1))
    const pageSize = Math.min(50, Math.max(1, Math.floor(opts?.pageSize ?? 24)))
    try {
      const json = await this.apiGet(
        '/x/centralization/interface/music/comprehensive/web/rank',
        { pn: page, ps: pageSize },
      )
      const data = json?.['data']
      const list = isRecord(data) && Array.isArray(data['list']) ? data['list'] : []

      return list
        .filter(isRecord)
        .map((item) => {
          const related = isRecord(item['related_archive'])
            ? (item['related_archive'] as Record<string, unknown>)
            : null
          const bvid =
            related?.['bvid']?.toString() ?? item['bvid']?.toString() ?? ''
          const cover = (related?.['cover'] ?? item['cover'])?.toString() ?? ''
          const title = stripHtmlTags(
            item['music_title']?.toString() ?? related?.['title']?.toString() ?? '未知标题',
          )
          const durationText = item['duration'] ?? related?.['duration']
          const pic = normalizeBilibiliImageUrl(cover)
          return {
            id: `bilibili:${bvid}`,
            title,
            artist: item['author']?.toString() ?? '未知艺人',
            source: 'bilibili',
            sourceLabel: 'B站热歌榜',
            duration: parseDurationSeconds(durationText) * 1000,
            coverUrl: pic,
            resultType: 'song',
            songCount: 1,
          } as RawSong
        })
        .filter((song) => !/^bilibili:$/.test(song['id']?.toString() ?? ''))
    } catch (e) {
      console.log(`[BilibiliMusicProvider] getMusicSongRank - 失败: ${e}`)
      return []
    }
  }

  /**
   * 音乐区热榜单曲 —— 对照 BiliMusic 的 getMusicRanking：
   * /x/web-interface/ranking/region?rid=3&day=3（音乐区三日热榜），
   * 客户端按页切片分页；过滤合集/无 bvid 条目，保证返回的是可直接播放的单曲。
   *
   * 注：热榜混有音乐区非歌曲类稿件（综艺/idol 剪辑），所以它只是
   * getMusicSongRank 的兜底，不作为首选推荐源。
   */
  async getMusicRanking(opts?: { page?: number; pageSize?: number }): Promise<RawSong[]> {
    const page = Math.max(1, Math.floor(opts?.page ?? 1))
    const pageSize = Math.min(50, Math.max(1, Math.floor(opts?.pageSize ?? 20)))
    try {
      const json = await this.apiGet('/x/web-interface/ranking/region', {
        rid: 3,
        day: 3,
      })
      const data = json?.['data']
      let list: unknown[] = []
      if (Array.isArray(data)) list = data
      else if (isRecord(data) && Array.isArray(data['list'])) list = data['list']

      const singles = list
        .filter(isRecord)
        .filter(hasPlayableBvid)
        .map((item) => {
          const bvid = item['bvid']?.toString() ?? ''
          const title = stripHtmlTags(item['title']?.toString() ?? '未知标题')
          const author = isRecord(item['owner'])
            ? (item['owner'] as Record<string, unknown>)['name']?.toString() ?? '未知UP主'
            : '未知UP主'
          const duration = typeof item['duration'] === 'number' ? (item['duration'] as number) : 0
          const pic = item['pic']?.toString() ?? ''
          return { bvid, title, author, duration, pic }
        })
        .filter((s) => !looksLikeCollection(s.title, s.duration))

      const start = (page - 1) * pageSize
      return singles.slice(start, start + pageSize).map((s) => ({
        id: `bilibili:${s.bvid}`,
        title: s.title,
        artist: s.author,
        source: 'bilibili',
        sourceLabel: 'B站音乐区热榜',
        duration: s.duration * 1000,
        coverUrl: normalizeBilibiliImageUrl(s.pic),
        resultType: 'song',
        songCount: 1,
      })) as RawSong[]
    } catch (e) {
      console.log(`[BilibiliMusicProvider] getMusicRanking - 失败: ${e}`)
      return []
    }
  }

  async getPlaylist(id: string, limit?: number): Promise<RawSong> {
    const bvid = this.extractBvid(id)

    try {
      const viewJson = await this.apiGet('/x/web-interface/view', { bvid })

      const data = viewJson?.['data']
      const viewData = isRecord(data) ? data : null
      const title = stripHtmlTags(viewData?.['title']?.toString() ?? '未知歌单')
      const owner = viewData?.['owner']
      const author = isRecord(owner)
        ? (owner['name']?.toString() ?? '未知UP主')
        : '未知UP主'
      const pic = viewData?.['pic']?.toString() ?? ''

      // 取分P列表（歌单内的歌曲）
      const pagesJson = await this.apiGet('/x/player/pagelist', {
        bvid,
        jsonp: 'jsonp',
      })

      const pagesRaw = pagesJson?.['data']
      const pages = Array.isArray(pagesRaw) ? pagesRaw : []
      const songs = pages
        .filter(isRecord)
        .slice(0, limit ?? 100)
        .map((pageItem) => {
          const pageNum =
            typeof pageItem['page'] === 'number' ? (pageItem['page'] as number) : 1
          const playbackId = `bilibili:${bvid}:p${pageNum}`
          const cid = pageItem['cid']?.toString() ?? ''
          const partTitle = pageItem['part']?.toString() ?? title
          const pageDuration =
            typeof pageItem['duration'] === 'number'
              ? (pageItem['duration'] as number)
              : 0

          return {
            id: playbackId,
            title: partTitle,
            artist: author,
            source: 'bilibili',
            sourceLabel: 'B站',
            playbackId,
            playbackSource: 'bilibili',
            playbackSourceLabel: 'B站',
            playbackSourceId: playbackId,
            sourceId: playbackId,
            bvid,
            page: pageNum,
            ...(cid !== '' ? { cid } : {}),
            pageUrl: `https://www.bilibili.com/video/${bvid}?p=${pageNum}`,
            resultType: 'song',
            duration: pageDuration * 1000,
            coverUrl: normalizeBilibiliImageUrl(pic),
          } as RawSong
        })

      return {
        id,
        title,
        subtitle: `${author} · ${songs.length} 首歌曲`,
        source: 'bilibili',
        songCount: songs.length,
        coverUrl: normalizeBilibiliImageUrl(pic),
        songs,
      }
    } catch (e) {
      throw new Error(`获取歌单失败: ${e}`)
    }
  }

  async getPlaylistSummary(playlist: RawSong): Promise<PlaylistSummary> {
    const id =
      playlist['playbackId']?.toString().trim() ??
      playlist['id']?.toString().trim() ??
      ''
    const bvid = this.extractBvid(id)
    if (bvid === '') return UNAVAILABLE_PLAYLIST_SUMMARY

    try {
      const json = await this.apiGet('/x/player/pagelist', {
        bvid,
        jsonp: 'jsonp',
      })
      const pagesRaw = json?.['data']
      const pages = Array.isArray(pagesRaw) ? pagesRaw.filter(isRecord) : []
      if (pages.length === 0) return UNAVAILABLE_PLAYLIST_SUMMARY

      const durationSeconds = pages.reduce<number>(
        (total, pageItem) =>
          total +
          (typeof pageItem['duration'] === 'number'
            ? (pageItem['duration'] as number)
            : 0),
        0,
      )
      let kind: PlaylistSummaryKind
      if (pages.length > 1) kind = 'multiPage'
      else if (durationSeconds >= 20 * 60) kind = 'singleLongCollection'
      else kind = 'singlePageCollection'
      return {
        available: true,
        kind,
        songCount: pages.length,
        durationSeconds,
      }
    } catch {
      return UNAVAILABLE_PLAYLIST_SUMMARY
    }
  }

  async getSongDetail(id: string): Promise<RawSong> {
    const bvid = this.extractBvid(id)

    try {
      const json = await this.apiGet('/x/web-interface/view', { bvid })

      const data = json?.['data']
      const viewData = isRecord(data) ? data : null
      const title = stripHtmlTags(viewData?.['title']?.toString() ?? '未知标题')
      const owner = viewData?.['owner']
      const author = isRecord(owner)
        ? (owner['name']?.toString() ?? '未知UP主')
        : '未知UP主'
      const pic = viewData?.['pic']?.toString() ?? ''
      const duration =
        typeof viewData?.['duration'] === 'number'
          ? (viewData['duration'] as number)
          : 0

      return {
        id,
        title,
        artist: author,
        source: 'bilibili',
        sourceLabel: 'B站',
        resultType: 'song',
        duration: duration * 1000,
        coverUrl: normalizeBilibiliImageUrl(pic),
      }
    } catch (e) {
      throw new Error(`获取歌曲详情失败: ${e}`)
    }
  }

  async getPlayUrl(id: string): Promise<PlaybackUrl> {
    console.log(`[BilibiliMusicProvider] getPlayUrl - ID: ${id}`)

    const parts = id.split(':')
    const bvid = parts.length > 1 ? (parts[1] ?? id) : id
    const page = parts.length > 2 ? parsePage(parts[2] ?? '') : 1

    console.log(`[BilibiliMusicProvider] 解析 ID: bvid=${bvid}, page=${page}`)

    if (bvid.trim() === '') {
      throw new Error('B 站视频 ID 无效，无法播放（该条目可能为课堂/番剧等非视频内容）')
    }

    try {
      // 取 CID
      console.log('[BilibiliMusicProvider] 获取 CID...')
      const pagesJson = await this.apiGet('/x/player/pagelist', {
        bvid,
        jsonp: 'jsonp',
      })

      const pagesRaw = pagesJson?.['data']
      const pages = Array.isArray(pagesRaw) ? pagesRaw : []
      const targetPage = pages.filter(isRecord)[page - 1]
      const cid = targetPage?.['cid']?.toString()

      if (cid == null) {
        console.log('[BilibiliMusicProvider] 未找到 CID')
        throw new Error('未找到视频分P信息')
      }

      console.log(`[BilibiliMusicProvider] CID: ${cid}`)
      this.cidByPlaybackId.set(id, cid)
      this.cidByPlaybackId.set(`bilibili:${bvid}:p${page}`, cid)

      // 取播放地址
      console.log('[BilibiliMusicProvider] 获取播放 URL...')
      const playJson = await this.apiGet(
        '/x/player/playurl',
        { bvid, cid, qn: 64, fnval: 16, fourk: 1 },
        {
          ...DEFAULT_HEADERS,
          Referer: `https://www.bilibili.com/video/${bvid}`,
        },
      )

      const playDataRaw = playJson?.['data']
      const playData = isRecord(playDataRaw) ? playDataRaw : null

      // 移动端解析逻辑：优先 dash.audio，降级 durl
      let url: string | null = null

      // 1. 尝试 dash.audio（高质量音频流）
      const dash = playData?.['dash']
      if (isRecord(dash)) {
        const audioRaw = dash['audio']
        const audios = Array.isArray(audioRaw) ? audioRaw.filter(isRecord) : []
        if (audios.length > 0) {
          // 按带宽排序，选最高质量
          audios.sort((a, b) => {
            const bandwidthA =
              typeof a['bandwidth'] === 'number' ? (a['bandwidth'] as number) : 0
            const bandwidthB =
              typeof b['bandwidth'] === 'number' ? (b['bandwidth'] as number) : 0
            return bandwidthB - bandwidthA
          })

          // 收集所有可用音频 URL
          for (const audio of audios) {
            const urls: string[] = [
              audio['baseUrl']?.toString() ?? '',
              audio['base_url']?.toString() ?? '',
            ]

            // 备用 URL
            for (const key of ['backupUrl', 'backup_url']) {
              const value = audio[key]
              if (Array.isArray(value)) {
                urls.push(...value.map((item) => item?.toString() ?? ''))
              } else if (value != null) {
                urls.push(value.toString())
              }
            }

            const validUrls = urls.filter((u) => u.trim() !== '')
            if (validUrls.length === 0) continue

            // 优先标准 CDN，避开 PCDN（详见 isPcdnMediaUrl 处注释）
            const preferredUrl = pickBestMediaUrl(validUrls)

            if (preferredUrl != null && preferredUrl !== '') {
              url = preferredUrl
              console.log(
                `[BilibiliMusicProvider] 从 dash.audio 获取 URL(${hostOf(url) || 'unknown'})`,
              )
              break
            }
          }
        }
      }

      // 2. dash 为空时降级 durl
      if (url == null || url === '') {
        const durlRaw = playData?.['durl']
        const durls = Array.isArray(durlRaw) ? durlRaw.filter(isRecord) : []
        if (durls.length > 0) {
          const durlUrls = durls.flatMap((item) => [
            item['url']?.toString() ?? '',
            ...(Array.isArray(item['backup_url'])
              ? (item['backup_url'] as unknown[]).map((v) => v?.toString() ?? '')
              : []),
          ])
          url = pickBestMediaUrl(durlUrls)
          console.log(
            `[BilibiliMusicProvider] 从 durl 获取 URL(${hostOf(url ?? '') || 'unknown'})`,
          )
        }
      }

      console.log(
        `[BilibiliMusicProvider] 最终播放 URL 主机: ${hostOf(url ?? '') || 'unknown'}`,
      )

      if (url == null || url === '') {
        const message = playData?.['message']?.toString() ?? '未获取到播放地址'
        console.log(`[BilibiliMusicProvider] 失败: ${message}`)
        throw new Error(message)
      }

      console.log('[BilibiliMusicProvider] getPlayUrl 成功')
      return playbackUrl(url, {
        headers: {
          Referer: `https://www.bilibili.com/video/${bvid}`,
          'User-Agent': DEFAULT_HEADERS['User-Agent'] ?? '',
        },
        resolvedId: id,
      })
    } catch (e) {
      console.log(`[BilibiliMusicProvider] getPlayUrl 失败: ${e}`)
      throw new Error(`获取播放地址失败: ${e}`)
    }
  }

  /** 从 B 站 CC 字幕取歌词 */
  private async fetchSubtitleLyrics(bvid: string, cid: string): Promise<string> {
    try {
      // 取字幕信息
      const playerJson = await this.apiGet(
        '/x/player/v2',
        { bvid, cid },
        {
          ...DEFAULT_HEADERS,
          Referer: `https://www.bilibili.com/video/${bvid}`,
        },
      )

      const data = playerJson?.['data']
      const subtitle = isRecord(data) ? data['subtitle'] : null
      const subtitlesRaw = isRecord(subtitle) ? subtitle['subtitles'] : null
      const subtitles = Array.isArray(subtitlesRaw) ? subtitlesRaw : []

      if (subtitles.length === 0) return ''

      // 取第一条字幕 URL
      const firstSubtitle = subtitles.filter(isRecord)[0]
      let subtitleUrl = firstSubtitle?.['subtitle_url']?.toString() ?? ''
      if (subtitleUrl === '') return ''

      // 归一化 URL
      if (subtitleUrl.startsWith('//')) {
        subtitleUrl = `https:${subtitleUrl}`
      }

      // 下载字幕内容（对应 Dart 无超时的独立 subtitleDio）
      const subtitleResponse = await fetch(subtitleUrl)
      const subtitleJson: unknown = await subtitleResponse.json()

      // 解析字幕 body
      const bodyRaw = isRecord(subtitleJson) ? subtitleJson['body'] : null
      const body = Array.isArray(bodyRaw) ? bodyRaw : []
      const lines = body
        .filter(isRecord)
        .map((item) => item['content']?.toString().trim() ?? '')
        .filter((line) => line !== '')
        .join('\n')

      console.log(`[BilibiliMusicProvider] 获取歌词成功，长度: ${lines.length}`)
      return lines
    } catch (e) {
      console.log(`[BilibiliMusicProvider] 获取歌词失败: ${e}`)
      return ''
    }
  }

  async getLyrics(song: RawSong): Promise<string> {
    const existing = song['lyrics']?.toString().trim() ?? ''
    if (existing !== '') return existing

    const playbackId =
      song['playbackId']?.toString().trim() ??
      song['id']?.toString().trim() ??
      ''
    if (playbackId === '') return ''

    const songBvid = song['bvid']?.toString().trim() ?? ''
    const bvid = songBvid !== '' ? songBvid : this.extractBvid(playbackId)
    const parts = playbackId.split(':')
    const page = parts.length > 2 ? parsePage(parts[2] ?? '') : 1
    let cid = song['cid']?.toString().trim() ?? ''
    if (cid === '') cid = this.cidByPlaybackId.get(playbackId) ?? ''

    if (cid === '') {
      const pagesJson = await this.apiGet('/x/player/pagelist', {
        bvid,
        jsonp: 'jsonp',
      })
      const pagesRaw = pagesJson?.['data']
      const pages = Array.isArray(pagesRaw) ? pagesRaw : []
      cid =
        pages
          .filter(isRecord)
          [page - 1]?.['cid']?.toString() ?? ''
      if (cid === '') return ''
      this.cidByPlaybackId.set(playbackId, cid)
    }

    return this.fetchSubtitleLyrics(bvid, cid)
  }

  private extractBvid(id: string): string {
    if (id.startsWith('bilibili:')) {
      const parts = id.substring(9).split(':')
      return parts[0] ?? ''
    }
    return id
  }

  // ---------- 传输层 ----------

  /** api.bilibili.com GET JSON；headers 默认带 Referer/Origin/UA */
  private async apiGet(
    path: string,
    query: Record<string, string | number>,
    headers: Record<string, string> = DEFAULT_HEADERS,
  ): Promise<Record<string, unknown> | null> {
    return getJson(`${API_BASE}${path}`, query, headers, BilibiliMusicProvider.requestTimeout)
  }

  /** gateway.karpov.cn 推荐 API；connect/receive/send 均为 recommendationTimeout */
  private async gatewayGet(
    path: string,
    query: Record<string, string | number>,
    timeoutMs: number,
  ): Promise<Record<string, unknown> | null> {
    return getJson(
      `${GATEWAY_BASE}${path}`,
      query,
      {
        Accept: 'application/json',
        'User-Agent': DEFAULT_HEADERS['User-Agent'] ?? '',
      },
      timeoutMs,
    )
  }
}

// ================= 静态工具（对应 Dart 私有方法/顶层逻辑） =================

async function getJson(
  baseUrl: string,
  query: Record<string, string | number>,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    params.set(k, String(v))
  }
  const url = `${baseUrl}?${params.toString()}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const data: unknown = await response.json()
    return isRecord(data) ? data : null
  } finally {
    clearTimeout(timer)
  }
}

function parsePage(value: string): number {
  const parsed = Number.parseInt(value.replace(/^[pP]/, ''), 10)
  const page = Number.isNaN(parsed) ? 1 : parsed
  return page < 1 ? 1 : page
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<em[^>]*>/g, '')
    .replace(/<\/em>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function parseDurationSeconds(value: unknown): number {
  if (typeof value === 'number') return Math.round(value)
  const text = value?.toString().trim() ?? ''
  if (text === '') return 0

  if (!text.includes(':')) {
    const n = Number.parseInt(text, 10)
    return Number.isNaN(n) ? 0 : n
  }

  const parts = text.split(':').map((part) => {
    const n = Number.parseInt(part, 10)
    return Number.isNaN(n) ? 0 : n
  })
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
  if (parts.length === 3)
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)
  return 0
}

function looksLikeCollection(title: string, durationSeconds: number): boolean {
  const quotedCount = extractQuotedSongTitles(title).length
  if (quotedCount > 1) return true

  const normalized = title.toLowerCase()
  if (/(合集|歌单|精选|串烧|盘点|多首|全\d+首|音乐包|playlist|collection)/i.test(normalized)) {
    return true
  }

  if (
    durationSeconds >= 20 * 60 &&
    /(音乐|歌曲|热歌|华语|流行|抖音|伤感|车载|bgm)/i.test(normalized)
  ) {
    return true
  }

  return false
}
