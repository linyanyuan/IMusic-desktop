/**
 * 离线缓存胶水层 —— 渲染层对主进程 audioCache（electron/audioCache.ts + imusic-audio:// 协议）
 * 的薄封装。
 *
 * 主进程已经处理好并发去重、.part 原子替换与完整性校验，这里只负责三件事：
 *   1. 把 Song 归一成缓存 meta，id 与 PlayerContext.songKey 用同一把 key（否则播放时查不到）；
 *   2. 给需要请求头的音源补请求头：优先用取链结果 PlaybackUrl.headers（已解析音源的权威值，
 *      如 B 站 CDN 的 Referer/UA），仅当 provider 没给时才退回到基于 Song 的启发式；
 *      该头缺失会用 403（主进程 session 注入只对渲染进程请求生效）。
 *   3. 串行批量缓存，单首失败只记录不中断整批。
 *
 * 纯浏览器预览下 window.imusicAPI 不存在，cacheSong 会抛明确错误（调用方按失败收进列表）。
 */

import type { Song } from '../services/models'
import { getServices } from '../services/runtime'

/** 与 PlayerContext.songKey 同款：播放与缓存必须用同一把 key 才能命中 */
function songKey(song: Song): string {
  return song.id?.toString() ?? ''
}

/** 与 electron/headers.ts 为 B 站 CDN 注入的 Referer 一致 */
const BILIBILI_REFERER = 'https://www.bilibili.com'

/**
 * 与 services/bilibili.ts 的 DEFAULT_HEADERS 同源（electron/headers.ts 只注入 Referer，
 * 不设置 UA，所以这里沿用项目内各 provider 统一的浏览器 UA 常量）。
 */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

/** B 站来源判定：与 services/hybrid.ts 的 isLikelyBilibiliSource 一致（id 前缀或 source 含 bilibili） */
function isBilibiliSong(song: Song): boolean {
  return song.id.startsWith('bilibili:') || song.source.includes('bilibili')
}

/**
 * 下载请求头。B 站音频 CDN 校验 Referer/User-Agent（主进程 session 的注入只对
 * 渲染进程请求生效，走 cacheDownload 的下载请求要显式带上）；其它源交给主进程。
 */
export function downloadHeadersFor(song: Song): Record<string, string> {
  if (!isBilibiliSong(song)) return {}
  return {
    Referer: BILIBILI_REFERER,
    'User-Agent': BROWSER_USER_AGENT,
  }
}

/**
 * 合并下载请求头：取链结果里的 provider 头是已解析音源的权威值，启发式只作兜底。
 *
 * 为什么需要：元数据 source 是 netease/qqmusic、实际播放却解析到 B 站 CDN 的 hybrid 歌曲
 * （meting id、ChKSz 回落），downloadHeadersFor 的启发式判定会返回 {}，主进程下载 403，
 * 该曲静默缓存失败。PlaybackUrl.headers 带了对应音源的真实 Referer/UA，必须以它为准。
 * 两者都有时 provider 覆盖同名的启发式键（如 B 站歌 provider 又给了别的 Referer）。
 */
export function chainDownloadHeaders(
  song: Song,
  providerHeaders?: Record<string, string> | null,
): Record<string, string> {
  return { ...downloadHeadersFor(song), ...(providerHeaders ?? {}) }
}

/** 单曲下载入库；resolve 的 url（imusic-audio://local/<key>）可直接喂给 <audio> */
export async function cacheSong(song: Song): Promise<{ url: string; bytes: number }> {
  const api = window.imusicAPI
  if (api == null) throw new Error('离线缓存不可用：当前环境没有 imusicAPI')

  const id = songKey(song)
  const playUrl = await getServices().music.getPlayUrl(id)
  return api.cacheDownload(
    { id, title: song.title, artist: song.artist, source: song.source },
    playUrl.url,
    chainDownloadHeaders(song, playUrl.headers),
  )
}

/**
 * 串行批量缓存：逐首下载，单首失败收集后继续，不中断整批。
 *
 * onProgress 在每首**开始前**调用，done 表示此前已完成（成功或失败）的首数。
 */
export async function cacheSongsSequentially(
  songs: Song[],
  onProgress: (done: number, total: number, current: Song) => void,
): Promise<{ ok: number; failed: Array<{ song: Song; error: string }> }> {
  const total = songs.length
  const failed: Array<{ song: Song; error: string }> = []
  let ok = 0

  for (let i = 0; i < total; i += 1) {
    const song = songs[i]
    onProgress(i, total, song)
    try {
      await cacheSong(song)
      ok += 1
    } catch (e) {
      failed.push({ song, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return { ok, failed }
}
