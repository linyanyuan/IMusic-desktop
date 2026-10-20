/**
 * 安装包差量下载的执行层：把 `blockmapDiff.ts` 算出的「操作表」真正落成文件。
 *
 * ## 为什么要单独一个文件
 *
 * `blockmapDiff.ts` 只做纯算法（不碰磁盘、不碰网络），而这个模块要把两种外部资源
 * 拼在一起：
 *
 * - **本地旧安装包**（上一次更新下到 `update-cache/installer-<旧版本>.exe` 的那份）
 * - **远端新安装包的若干字节区间**（HTTP Range 请求）
 *
 * 真实网络实现（走 Chromium 网络栈的 `net.fetch`、带主机白名单、带空闲看门狗）
 * 属于 `update.ts` 的职责，所以这里把网络抽成注入的 `fetchRange`、把日志/进度抽成
 * 注入的 `onProgress`：本文件**不 import electron**，于是 `node --test` 能直接用假
 * 的 `fetchRange` 跑完整流程（见 tests/differential-download.test.ts），也能拿真实的
 * 两个发布安装包做端到端校验。
 *
 * ## 语义约定
 *
 * - 下载区间是**闭区间** `[start, end]`（与 blockmapDiff 的 `DiffOperation` 一致）。
 * - 任何「不对劲」都只返回 `{ ok: false, reason }`，**绝不抛异常** —— 差量更新只是
 *   「有则快 100 倍、无则回退全量」的优化，不能把更新流程搞坏。上层拿到 `ok:false`
 *   后删掉半成品 `.part` 再走全量即可。
 * - 失败时尽力删掉 `targetPath`，避免把半截安装包留在临时目录里被误当成可用的包。
 */
import { createWriteStream } from 'node:fs'
import { promises as fsp } from 'node:fs'
import type { WriteStream } from 'node:fs'
import { computeDiffOperations, downloadBytes, parseBlockmap } from './blockmapDiff'

/** 从旧安装包拷字节时的单次读长度：1MB 足够摊平 syscall 开销，又不至于大段分配内存。 */
const COPY_CHUNK_BYTES = 1024 * 1024

/**
 * 收益阈值：如果差量算下来仍要下载新包的 60% 以上，就不值得走差量。
 *
 * 理由有两条：
 * 1. 差量路径是「几百个 Range 请求 + 本地拼接」，全量只是一条流式连接；下载量差
 *    不多时全量更稳（更少的请求 = 更少的失败点）。
 * 2. 差量路径要在内存里持有「新 blockmap + 每段响应体」，收益不足时干脆别开这个头。
 */
const WORTHWHILE_RATIO = 0.6

export interface DifferentialInput {
  /** 本地缓存的上一个版本安装包（当前运行版本） */
  oldInstallerPath: string
  /** 旧版本 blockmap 原始字节（gzip） */
  oldBlockmapRaw: Uint8Array
  /** 新版本 blockmap 原始字节（gzip） */
  newBlockmapRaw: Uint8Array
  /** 组装结果写到这里（调用方传入 .part 临时路径） */
  targetPath: string
  /** 取新安装包的字节闭区间；由调用方注入真实网络实现（测试注入假实现） */
  fetchRange: (start: number, end: number) => Promise<Uint8Array>
  onProgress?: (received: number, total: number) => void
  signal?: AbortSignal
}

export interface DifferentialSuccess {
  ok: true
  /** 新安装包总字节数 */
  total: number
  /** 实际下载字节数（copy 的字节不算） */
  downloaded: number
  /** 操作段数（诊断/日志用） */
  operations: number
}

export type DifferentialOutcome = DifferentialSuccess | { ok: false; reason: string }

/** 把一块数据写进输出流并等它被接收（背压交给 Node 的 write 回调处理）。 */
function writeChunk(stream: WriteStream, data: Uint8Array): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.write(data, (error) => (error == null ? resolve() : reject(error)))
  })
}

/** 校验操作表是否**无缝覆盖**整个新文件（差量拼接最容易出的错就是漏/重一段）。 */
function coverageError(
  operations: ReturnType<typeof computeDiffOperations>,
  totalSize: number,
): string | null {
  let cursor = 0
  for (const op of operations) {
    const start = op.type === 'copy' ? op.targetOffset : op.start
    const size = op.type === 'copy' ? op.size : op.end - op.start + 1
    if (start !== cursor) {
      return `差量区间不连续（覆盖到 ${cursor}/${totalSize}）`
    }
    cursor += size
  }
  if (cursor !== totalSize) {
    return `差量区间不连续（覆盖到 ${cursor}/${totalSize}）`
  }
  return null
}

/**
 * 用「本地旧安装包 + 远端新包的差异区间」拼出新安装包，写到 `input.targetPath`。
 *
 * 成功时 `targetPath` 的字节与新安装包完全一致（sha256 由调用方校验），返回里带
 * 「实际下载了多少字节」供日志/诊断使用。
 */
export async function downloadDifferential(
  input: DifferentialInput,
): Promise<DifferentialOutcome> {
  const { signal, targetPath } = input

  // ---- 1. 解析两侧 blockmap（真实文件是 gzip 压缩的 JSON） ----
  const oldMap = parseBlockmap(input.oldBlockmapRaw)
  const newMap = parseBlockmap(input.newBlockmapRaw)
  if (oldMap == null || newMap == null) {
    return { ok: false, reason: 'blockmap 解析失败' }
  }
  const total = newMap.totalSize

  // ---- 2. 算操作表并校验覆盖完整性 ----
  const operations = computeDiffOperations(oldMap, newMap)
  const coverage = coverageError(operations, total)
  if (coverage != null) return { ok: false, reason: coverage }

  // ---- 3. 收益阈值：收益太小就别折腾，交给全量下载 ----
  const planned = downloadBytes(operations)
  if (planned >= total * WORTHWHILE_RATIO) {
    const percent = Math.round((planned / total) * 100)
    return { ok: false, reason: `差量收益不足（需下载 ${percent}%），改走全量下载` }
  }

  // ---- 4. 组装 ----
  const abortError = () => new Error('已取消')
  const assertNotAborted = () => {
    if (signal?.aborted === true) throw abortError()
  }

  let handle: fsp.FileHandle | null = null
  let stream: WriteStream | null = null
  /** 写流自身的错误（'error' 事件不监听会变成 uncaughtException） */
  let streamError: Error | null = null

  let received = 0
  let downloaded = 0

  try {
    handle = await fsp.open(input.oldInstallerPath, 'r')
    stream = createWriteStream(targetPath)
    stream.on('error', (error: Error) => {
      streamError = error
    })

    assertNotAborted()

    for (const op of operations) {
      if (op.type === 'copy') {
        // 分块从旧包拷，避免一次性把几十 MB 读进内存。
        const chunkBytes = Math.min(COPY_CHUNK_BYTES, op.size)
        const buffer = Buffer.allocUnsafe(chunkBytes)
        let copied = 0
        while (copied < op.size) {
          assertNotAborted()
          const want = Math.min(chunkBytes, op.size - copied)
          const { bytesRead } = await handle.read(buffer, 0, want, op.sourceOffset + copied)
          if (bytesRead <= 0) {
            throw new Error(`旧安装包内容不足（期望 ${op.size} 字节，只读到 ${copied}）`)
          }
          await writeChunk(stream, buffer.subarray(0, bytesRead))
          if (streamError != null) throw streamError
          copied += bytesRead
          received += bytesRead
          input.onProgress?.(received, total)
        }
        continue
      }

      // download：闭区间，要求注入实现严格返回对应长度
      const expected = op.end - op.start + 1
      assertNotAborted()
      const chunk = await input.fetchRange(op.start, op.end)
      if (!(chunk instanceof Uint8Array) || chunk.byteLength !== expected) {
        const actual = chunk instanceof Uint8Array ? chunk.byteLength : -1
        throw new Error(`下载字节数不符（区间 ${op.start}-${op.end} 期望 ${expected}，收到 ${actual}）`)
      }
      await writeChunk(stream, Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
      if (streamError != null) throw streamError
      downloaded += expected
      received += expected
      assertNotAborted()
      input.onProgress?.(received, total)
    }

    // ---- 5. 收尾：等写流 flush 完再关文件句柄 ----
    const closing = stream
    stream = null
    await new Promise<void>((resolve, reject) => {
      closing.end((error?: Error | null) => (error == null ? resolve() : reject(error)))
    })
    await handle.close()
    handle = null

    input.onProgress?.(received, total)
    return { ok: true, total, downloaded, operations: operations.length }
  } catch (error) {
    // 收尾 + 清理：半写文件绝不能留在临时目录里（.part 被误当可用包会很难查）。
    const closing = stream
    if (closing != null) {
      await new Promise<void>((resolve) => {
        closing.once('error', () => resolve())
        closing.end(() => resolve())
      })
    }
    if (handle != null) {
      await handle.close().catch(() => undefined)
    }
    await fsp.rm(targetPath, { force: true }).catch(() => undefined)

    if (signal?.aborted === true) return { ok: false, reason: '已取消' }
    if (error instanceof Error && error.name === 'AbortError') return { ok: false, reason: '已取消' }
    return { ok: false, reason: String((error as Error)?.message ?? error) }
  }
}
