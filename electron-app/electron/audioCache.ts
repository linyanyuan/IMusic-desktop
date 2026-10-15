/**
 * 音频缓存 —— 移植 BiliMusic downloads.ts 的完整性设计：
 * - 下载到 .part 临时文件 → 完整性校验（size>0 + 容器头 + sha256 receipt）→ 原子 rename
 * - 命中前复检：文件不存在 / size 为 0 / 容器头不符 / receipt 不一致 → 视为未命中重下
 * - 防半截文件被当缓存命中（Flutter 版只有 size>0 检查的加固）
 */

import { createHash } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { open, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { enqueueDownload } from './downloadQueue'

const EXT = '.m4a'
const PART_SUFFIX = '.part'
const RECEIPT_SUFFIX = '.sha256'

/** 用户可在设置页指定缓存目录；为 null 时用 userData/audio-cache */
let directoryOverride: string | null = null

/** 设置页下发缓存目录（空串/null 表示恢复默认）。返回最终生效的目录 */
export function setCacheDirectory(dir: string | null): string {
  const trimmed = dir?.trim() ?? ''
  directoryOverride = trimmed === '' ? null : trimmed
  return cacheDir()
}

function cacheDir(): string {
  const dir = directoryOverride ?? join(app.getPath('userData'), 'audio-cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** id 里可能带 : ? 等非法文件名字符 → sha256 文件名 */
export function cacheKeyFor(id: string): string {
  return createHash('sha256').update(id).digest('hex')
}

export function cachePathFor(id: string): string {
  return cachePathForToken(cacheKeyFor(id))
}

/** 已经是 cache key（token）时直接拼路径；协议层用它，保证与 getOrDownload 同目录 */
export function cachePathForToken(token: string): string {
  return join(cacheDir(), `${token}${EXT}`)
}

function receiptPathFor(filePath: string): string {
  return `${filePath}${RECEIPT_SUFFIX}`
}

// ---------------- 完整性校验 ----------------

/** 容器头嗅探：MP4/M4A 期望 offset4 起是 ftyp；MP3 期望 ID3 或帧同步 0xFF 0xEx */
export async function sniffContainerKind(
  filePath: string,
): Promise<'mp4' | 'mp3' | 'unknown'> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(filePath, 'r')
  } catch {
    return 'unknown'
  }
  try {
    const buf = Buffer.alloc(12)
    const { bytesRead } = await handle.read(buf, 0, 12, 0)
    if (bytesRead < 4) return 'unknown'
    if (bytesRead >= 8 && buf.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4'
    if (bytesRead >= 3 && buf.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3'
    if (bytesRead >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3'
    return 'unknown'
  } finally {
    await handle.close()
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

export interface IntegrityReport {
  ok: boolean
  reason?: string
  sha256?: string
  /** 嗅探出的容器类型（ok=true 时用于挑正确 MIME） */
  kind?: 'mp4' | 'mp3'
}

/** 校验一个已完成文件；ok=false 时给出原因。异步 IO，不阻塞主进程事件循环 */
export async function verifyCachedFile(filePath: string): Promise<IntegrityReport> {
  let size: number
  try {
    size = (await stat(filePath)).size
  } catch {
    return { ok: false, reason: 'missing' }
  }
  if (size <= 0) return { ok: false, reason: 'empty' }

  const kind = await sniffContainerKind(filePath)
  if (kind === 'unknown') return { ok: false, reason: 'bad-container-header' }

  const receiptPath = receiptPathFor(filePath)
  let expected: string | null = null
  try {
    expected = (await readFile(receiptPath, 'utf8')).trim()
  } catch {
    expected = null
  }
  const actual = await sha256File(filePath)
  if (expected !== null) {
    if (expected !== actual) return { ok: false, reason: 'sha256-mismatch' }
    return { ok: true, sha256: actual, kind }
  }
  // 无 receipt（旧缓存）：补写一份，本次视为可信（内容头已对）
  await writeFile(receiptPath, actual, 'utf8')
  return { ok: true, sha256: actual, kind }
}

// ---------------- 下载 + 入库 ----------------

export interface CacheEntry {
  id: string
  path: string
  bytes: number
}

/** 同一 id 的并发请求共享同一下载任务，避免两个写入者争抢同一个 .part */
const inflight = new Map<string, Promise<CacheEntry>>()

/** 命中返回路径；未命中/损坏则重下。headers 由调用方传入（B 站 Referer）。
 *  同一 id 的并发调用会被串行化（复用同一下载 Promise）。 */
export function getOrDownload(
  id: string,
  url: string,
  headers: Record<string, string>,
): Promise<CacheEntry> {
  const existing = inflight.get(id)
  if (existing != null) return existing
  const task = performDownload(id, url, headers).finally(() => {
    inflight.delete(id)
  })
  inflight.set(id, task)
  return task
}

async function performDownload(
  id: string,
  url: string,
  headers: Record<string, string>,
): Promise<CacheEntry> {
  const finalPath = cachePathFor(id)

  const existing = await verifyCachedFile(finalPath).catch(() => ({ ok: false }) as IntegrityReport)
  if (existing.ok) {
    return { id, path: finalPath, bytes: statSync(finalPath).size }
  }
  // 损坏文件清掉重来
  rmSync(finalPath, { force: true })
  rmSync(receiptPathFor(finalPath), { force: true })

  const partPath = `${finalPath}${PART_SUFFIX}`
  rmSync(partPath, { force: true })

  let result
  try {
    result = await enqueueDownload({ url, headers, destPath: partPath })
  } catch (e) {
    // 下载失败不留半截 .part
    rmSync(partPath, { force: true })
    throw e
  }
  if (result.bytes <= 0) {
    rmSync(partPath, { force: true })
    throw new Error('downloaded empty file')
  }

  const kind = await sniffContainerKind(partPath)
  if (kind === 'unknown') {
    rmSync(partPath, { force: true })
    throw new Error('downloaded file failed container-header check')
  }

  const digest = await sha256File(partPath)
  renameSync(partPath, finalPath)
  writeFileSync(receiptPathFor(finalPath), digest, 'utf8')
  return { id, path: finalPath, bytes: result.bytes }
}

// ---------------- 统计/清理 ----------------

export function cacheStats(): { fileCount: number; totalBytes: number; directory: string } {
  let fileCount = 0
  let totalBytes = 0
  for (const name of readdirSync(cacheDir())) {
    if (!name.endsWith(EXT)) continue
    fileCount += 1
    totalBytes += statSync(join(cacheDir(), name)).size
  }
  return { fileCount, totalBytes, directory: cacheDir() }
}

export function clearCache(): { removed: number; freedBytes: number } {
  let removed = 0
  let freedBytes = 0
  for (const name of readdirSync(cacheDir())) {
    const p = join(cacheDir(), name)
    if (name.endsWith(EXT)) {
      freedBytes += statSync(p).size
      removed += 1
    }
    rmSync(p, { force: true })
  }
  return { removed, freedBytes }
}

/** 按 mtime 清理超过 maxAgeMs 的条目 */
export function clearExpired(maxAgeMs: number): { removed: number } {
  const cutoff = Date.now() - maxAgeMs
  let removed = 0
  for (const name of readdirSync(cacheDir())) {
    if (!name.endsWith(EXT)) continue
    const p = join(cacheDir(), name)
    if (statSync(p).mtimeMs < cutoff) {
      rmSync(p, { force: true })
      rmSync(receiptPathFor(p), { force: true })
      removed += 1
    }
  }
  return { removed }
}

export function invalidate(id: string): boolean {
  const p = cachePathFor(id)
  const existed = existsSync(p)
  rmSync(p, { force: true })
  rmSync(receiptPathFor(p), { force: true })
  return existed
}

// ---------------- IPC ----------------

export function registerAudioCacheHandlers(): void {
  ipcMain.handle(
    'imusic:cacheGetOrDownload',
    async (_e, id: string, url: string, headers: Record<string, string>) => {
      const entry = await getOrDownload(id, url, headers ?? {})
      return entry
    },
  )
  ipcMain.handle('imusic:cacheInvalidate', (_e, id: string) => invalidate(id))
  ipcMain.handle('imusic:cacheStats', () => cacheStats())
  ipcMain.handle('imusic:cacheSetDirectory', (_e, dir: string | null) =>
    setCacheDirectory(dir),
  )
  ipcMain.handle('imusic:cacheClear', () => clearCache())
  ipcMain.handle('imusic:cacheClearExpired', (_e, maxAgeMs: number) =>
    clearExpired(maxAgeMs),
  )
}
