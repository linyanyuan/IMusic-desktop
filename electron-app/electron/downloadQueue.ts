/**
 * 全局下载队列 —— 移植 BiliMusic 的风控策略：
 * - 全局 2 并发上限（防 B 站 412/429）
 * - 重定向逐跳校验（最多 5 跳，仅允许 http/https）
 * - 使用 Node 内置 fetch（undici），不带 Electron session Cookie
 */

export interface DownloadTask {
  url: string
  headers?: Record<string, string>
  destPath: string // 调用方给的 .part 临时路径
}

export interface DownloadResult {
  bytes: number
  finalUrl: string
}

type QueuedJob = {
  task: DownloadTask
  resolve: (r: DownloadResult) => void
  reject: (e: Error) => void
}

const MAX_CONCURRENT = 2
const MAX_REDIRECTS = 5
/** 无数据流入的空闲超时：连接挂死时释放并发槽，不让整个队列卡住 */
const STALL_TIMEOUT_MS = 60_000

const queue: QueuedJob[] = []
let running = 0

/** 排队下载；全局最多 2 个并发 */
export function enqueueDownload(task: DownloadTask): Promise<DownloadResult> {
  return new Promise<DownloadResult>((resolve, reject) => {
    queue.push({ task, resolve, reject })
    pump()
  })
}

function pump(): void {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()
    if (job == null) return
    running += 1
    void downloadWithRedirectValidation(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        running -= 1
        pump()
      })
  }
}

/** 逐跳跟随重定向并校验协议与跳数 */
async function downloadWithRedirectValidation(
  task: DownloadTask,
): Promise<DownloadResult> {
  let url = task.url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const armWatchdog = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => controller.abort(new Error('download stalled')), STALL_TIMEOUT_MS)
    }
    armWatchdog()

    try {
      const res = await fetch(url, {
        redirect: 'manual',
        headers: task.headers ?? {},
        signal: controller.signal,
      })

      if (isRedirect(res.status)) {
        const location = res.headers.get('location')
        if (location == null || location === '') {
          throw new Error(`redirect ${res.status} without Location`)
        }
        const next = new URL(location, url)
        if (next.protocol !== 'https:' && next.protocol !== 'http:') {
          throw new Error(`refusing redirect to ${next.protocol}`)
        }
        // 重定向响应体不会被读取：主动取消，避免 undici 连接泄漏
        await res.body?.cancel().catch(() => undefined)
        url = next.toString()
        continue
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`)
      }
      if (res.body == null) {
        throw new Error('empty response body')
      }

      // 只有未压缩传输才能用 Content-Length 校验完整性（压缩会被自动解码，长度对不上）
      const contentEncoding = res.headers.get('content-encoding')
      const declaredLength = Number(res.headers.get('content-length') ?? '')

      const { createWriteStream } = await import('node:fs')
      const { Readable } = await import('node:stream')
      const { pipeline } = await import('node:stream/promises')

      // SAFETY: Node18+ 的 undici fetch body 是 web ReadableStream，与 node:stream/web 结构一致，
      // Readable.fromWeb 官方接受该类型；TS 的 DOM lib 与 node:stream/web 类型名义不同但运行时可互转。
      const nodeStream = Readable.fromWeb(
        res.body as unknown as import('node:stream/web').ReadableStream,
      )
      // 有数据持续流入说明没卡死，重置空闲看门狗
      nodeStream.on('data', armWatchdog)
      await pipeline(nodeStream, createWriteStream(task.destPath))

      const { stat } = await import('node:fs/promises')
      const bytes = (await stat(task.destPath)).size
      if (
        contentEncoding == null &&
        Number.isFinite(declaredLength) &&
        declaredLength > 0 &&
        bytes !== declaredLength
      ) {
        throw new Error(`incomplete download: ${bytes}/${declaredLength} bytes for ${url}`)
      }
      return { bytes, finalUrl: url }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
  throw new Error(`too many redirects (> ${MAX_REDIRECTS})`)
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}
