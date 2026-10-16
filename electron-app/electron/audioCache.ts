/**
 * 音频缓存 —— 移植 BiliMusic downloads.ts 的完整性设计：
 * - 下载到 .part 临时文件 → 完整性校验（size>0 + 容器头 + sha256 receipt）→ 原子 rename
 * - 命中前复检：文件不存在 / size 为 0 / 容器头不符 / receipt 不一致 → 视为未命中重下
 * - 防半截文件被当缓存命中（Flutter 版只有 size>0 检查的加固）
 * - 元数据索引 cache-index.json：离线缓存列表（标题/歌手/音源/大小/入库时间）
 */

import { createHash } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
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

/** 本地缓存协议 scheme（cacheProtocol.ts 用它注册特权协议，audioUrlFor 用它拼 URL） */
export const AUDIO_SCHEME = 'imusic-audio'

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

/** 由缓存 id 生成渲染层可用的协议 URL（token = cache key，渲染层看不到真实路径） */
export function audioUrlFor(id: string): string {
  return `${AUDIO_SCHEME}://local/${cacheKeyFor(id)}`
}

export function cachePathFor(id: string): string {
  return cachePathForToken(cacheKeyFor(id))
}

/** 已经是 cache key（token）时直接拼路径；协议层用它，保证与 getOrDownload 同目录 */
export function cachePathForToken(token: string): string {
  return cachePathForTokenIn(cacheDir(), token)
}

/** 纯函数版：显式给缓存目录，便于单测（cachePathForToken 只是它的薄封装） */
export function cachePathForTokenIn(dir: string, token: string): string {
  return join(dir, `${token}${EXT}`)
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

/** 缓存曲目的元信息（离线缓存列表用）；不传时索引里只留空标题 */
export interface CacheTrackMeta {
  title: string
  artist: string
  source: string
}

/** 同一 id 的并发请求共享同一下载任务，避免两个写入者争抢同一个 .part */
const inflight = new Map<string, Promise<CacheEntry>>()

/** 命中返回路径；未命中/损坏则重下。headers 由调用方传入（B 站 Referer）。
 *  同一 id 的并发调用会被串行化（复用同一下载 Promise）。
 *  meta 可选：给了就写进元数据索引（离线缓存列表），旧调用不传也能用。 */
export function getOrDownload(
  id: string,
  url: string,
  headers: Record<string, string>,
  meta?: CacheTrackMeta,
): Promise<CacheEntry> {
  const existing = inflight.get(id)
  if (existing != null) return existing
  const task = performDownload(id, url, headers, meta).finally(() => {
    inflight.delete(id)
  })
  inflight.set(id, task)
  return task
}

async function performDownload(
  id: string,
  url: string,
  headers: Record<string, string>,
  meta?: CacheTrackMeta,
): Promise<CacheEntry> {
  const finalPath = cachePathFor(id)

  const existing = await verifyCachedFile(finalPath).catch(() => ({ ok: false }) as IntegrityReport)
  if (existing.ok) {
    const bytes = statSync(finalPath).size
    // 命中也要落索引：旧缓存（索引引入前下的）第一次播放即补上元数据
    recordCacheEntry(cacheDir(), id, bytes, meta)
    return { id, path: finalPath, bytes }
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
  recordCacheEntry(cacheDir(), id, result.bytes, meta)
  return { id, path: finalPath, bytes: result.bytes }
}

// ---------------- 元数据索引 ----------------
//
// 索引读写函数都是纯函数（目录显式传入），只有下面的薄封装才用 electron 的 cacheDir()，
// 这样 node --test 能直接测（见 tests/audio-cache-index.test.ts）。

export interface CachedTrack {
  id: string
  title: string
  artist: string
  source: string
  bytes: number
  /** 入库时间（epoch ms） */
  cachedAt: number
}

/** cacheKey（cacheKeyFor(id)）→ 元数据 */
export type CacheIndex = Record<string, CachedTrack>

/** 缓存目录下的索引文件名 */
export const CACHE_INDEX_FILE = 'cache-index.json'

/** 原子替换用的临时文件名（与索引同目录，renameSync 才能保证原子） */
export const CACHE_INDEX_TMP_FILE = `${CACHE_INDEX_FILE}.tmp`

export function cacheIndexPathIn(dir: string): string {
  return join(dir, CACHE_INDEX_FILE)
}

function cacheIndexTmpPathIn(dir: string): string {
  return join(dir, CACHE_INDEX_TMP_FILE)
}

function isCachedTrack(value: unknown): value is CachedTrack {
  if (value == null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.artist === 'string' &&
    typeof v.source === 'string' &&
    typeof v.bytes === 'number' &&
    typeof v.cachedAt === 'number'
  )
}

/** 读索引。文件缺失 / JSON 损坏 / 结构不符一律按空索引处理 ——
 *  索引只是离线列表的展示数据，不该因为它坏掉就让播放失败 */
export function readCacheIndex(dir: string): CacheIndex {
  let raw: string
  try {
    raw = readFileSync(cacheIndexPathIn(dir), 'utf8')
  } catch {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const index: CacheIndex = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isCachedTrack(value)) index[key] = value
  }
  return index
}

/** 写索引：先写同目录临时文件再 renameSync 原子替换。
 *  直接覆盖写的话，进程崩溃/写到一半会把 cache-index.json 截断成坏 JSON，
 *  而 readCacheIndex 对坏文件按空索引容错 → 已缓存曲目的标题/歌手会静默全部丢失
 *  （播放路径不会重新记录，只有重新下载才会恢复）。 */
export function writeCacheIndex(dir: string, index: CacheIndex): void {
  mkdirSync(dir, { recursive: true })
  const tmpPath = cacheIndexTmpPathIn(dir)
  writeFileSync(tmpPath, JSON.stringify(index, null, 2), 'utf8')
  renameSync(tmpPath, cacheIndexPathIn(dir))
}

/** 在调用方已读出的索引对象上落一条并写盘。
 *  调用方手里已有最新索引时用它，避免再整表读一次（命中路径每次播放都会走到）。 */
function writeIndexEntry(
  dir: string,
  index: CacheIndex,
  cacheKey: string,
  entry: CachedTrack,
): void {
  index[cacheKey] = entry
  writeCacheIndex(dir, index)
}

export function upsertCacheIndexEntry(
  dir: string,
  cacheKey: string,
  entry: CachedTrack,
): void {
  const index = readCacheIndex(dir)
  writeIndexEntry(dir, index, cacheKey, entry)
}

/** 批量删索引项：整表只读改一次。用于清理一批过期缓存，
 *  避免 N 个文件触发 N 次 readFileSync + JSON.parse + 整表写（清理在启动路径的主线程上）。
 *  返回实际被删掉的条目数；一个都没命中时不写盘。 */
export function removeCacheIndexEntries(
  dir: string,
  cacheKeys: readonly string[],
): number {
  if (cacheKeys.length === 0) return 0
  const index = readCacheIndex(dir)
  let removed = 0
  for (const cacheKey of cacheKeys) {
    if (!(cacheKey in index)) continue
    delete index[cacheKey]
    removed += 1
  }
  if (removed > 0) writeCacheIndex(dir, index)
  return removed
}

export function removeCacheIndexEntry(dir: string, cacheKey: string): void {
  removeCacheIndexEntries(dir, [cacheKey])
}

/** 轻量命中检查：文件存在且不为空（不做 sha256，播前调用要快） */
function fileHasContent(filePath: string): boolean {
  try {
    return statSync(filePath).size > 0
  } catch {
    return false
  }
}

/** 剔除「文件已不在/为空」的索引项并落盘；返回剔除后的索引 */
export function pruneCacheIndex(dir: string): CacheIndex {
  const index = readCacheIndex(dir)
  const kept: CacheIndex = {}
  let dropped = false
  for (const [key, entry] of Object.entries(index)) {
    if (fileHasContent(cachePathForTokenIn(dir, key))) kept[key] = entry
    else dropped = true
  }
  if (dropped) writeCacheIndex(dir, kept)
  return kept
}

function sameTrack(a: CachedTrack, b: CachedTrack): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.artist === b.artist &&
    a.source === b.source &&
    a.bytes === b.bytes &&
    a.cachedAt === b.cachedAt
  )
}

/** 落一条索引项；不带 meta 时保留索引里已有的标题信息（避免旧调用把标题抹空）。
 *  命中路径每次播放都会调到这里，所以无变化时不写盘（同步写会阻塞主进程）。 */
function recordCacheEntry(
  dir: string,
  id: string,
  bytes: number,
  meta?: CacheTrackMeta,
): void {
  const key = cacheKeyFor(id)
  // 整表只读一次：下面用同一个索引对象落盘，不再让 upsert 重读一遍
  const index = readCacheIndex(dir)
  const existing = index[key]
  const entry: CachedTrack = {
    id,
    title: meta?.title ?? existing?.title ?? '',
    artist: meta?.artist ?? existing?.artist ?? '',
    source: meta?.source ?? existing?.source ?? '',
    bytes,
    cachedAt: existing?.cachedAt ?? Date.now(),
  }
  if (existing != null && sameTrack(existing, entry)) return
  writeIndexEntry(dir, index, key, entry)
}

// ---------------- 离线缓存（渲染层用的薄封装） ----------------

/** 播放前的轻量命中检查：只 stat 一次文件，不做 sha256（真正的完整性校验由
 *  imusic-audio:// 流式读取时的 verifyCachedFile 完成）。命中返回协议 URL 与字节数 */
export function lookupCachedIn(
  dir: string,
  id: string,
): { url: string; bytes: number } | null {
  try {
    const bytes = statSync(cachePathForTokenIn(dir, cacheKeyFor(id))).size
    if (bytes <= 0) return null
    return { url: audioUrlFor(id), bytes }
  } catch {
    return null
  }
}

export function lookupCached(id: string): { url: string; bytes: number } | null {
  return lookupCachedIn(cacheDir(), id)
}

/** 离线缓存列表，按入库时间倒序；文件已不在的项顺手从索引剔除且不返回 */
export function listCachedIn(dir: string): CachedTrack[] {
  return Object.values(pruneCacheIndex(dir)).sort((a, b) => b.cachedAt - a.cachedAt)
}

export function listCached(): CachedTrack[] {
  return listCachedIn(cacheDir())
}

/** 删缓存文件 + 校验 receipt + 索引项；返回之前是否真有缓存文件 */
export function removeCachedIn(dir: string, id: string): boolean {
  const key = cacheKeyFor(id)
  const filePath = cachePathForTokenIn(dir, key)
  const existed = existsSync(filePath)
  rmSync(filePath, { force: true })
  rmSync(receiptPathFor(filePath), { force: true })
  removeCacheIndexEntry(dir, key)
  return existed
}

export function removeCached(id: string): boolean {
  return removeCachedIn(cacheDir(), id)
}

/** 下载并入库（getOrDownload 的包装）：成功返回可直接喂给 <audio> 的协议 URL */
export async function downloadToCache(
  meta: { id: string } & CacheTrackMeta,
  url: string,
  headers: Record<string, string>,
): Promise<{ url: string; bytes: number }> {
  const entry = await getOrDownload(meta.id, url, headers, meta)
  return { url: audioUrlFor(meta.id), bytes: entry.bytes }
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
  const dir = cacheDir()
  let removed = 0
  let freedBytes = 0
  for (const name of readdirSync(dir)) {
    // 索引文件单独特判：随目录一起清空，不留空索引
    // （残留的 cache-index.json.tmp 走下面的通用分支删掉，不会变成永不清理的垃圾）
    if (name === CACHE_INDEX_FILE) continue
    const p = join(dir, name)
    if (name.endsWith(EXT)) {
      freedBytes += statSync(p).size
      removed += 1
    }
    rmSync(p, { force: true })
  }
  rmSync(cacheIndexPathIn(dir), { force: true })
  return { removed, freedBytes }
}

/** 按 mtime 清理超过 maxAgeMs 的条目 */
export function clearExpired(maxAgeMs: number): { removed: number } {
  const dir = cacheDir()
  const cutoff = Date.now() - maxAgeMs
  let removed = 0
  // 文件名就是 cacheKey（token）；先只收集，循环结束后一次性改索引并落盘
  const expiredKeys: string[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(EXT)) continue
    const p = join(dir, name)
    if (statSync(p).mtimeMs < cutoff) {
      rmSync(p, { force: true })
      rmSync(receiptPathFor(p), { force: true })
      expiredKeys.push(name.slice(0, -EXT.length))
      removed += 1
    }
  }
  removeCacheIndexEntries(dir, expiredKeys)
  return { removed }
}

/** 作废某曲缓存（文件 + receipt + 索引项）；返回之前是否存在 */
export function invalidate(id: string): boolean {
  return removeCached(id)
}

// ---------------- IPC ----------------

/** 参数校验：IPC 入参来自渲染层，类型不对要立刻抛中文错误，别让非法值渗进文件路径 */
function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${label} 必须是非空字符串`)
  }
  return value
}

/** headers：null/undefined 视为 {}；其余必须是字符串字典 */
function requireStringRecord(value: unknown, label: string): Record<string, string> {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是字符串字典`)
  }
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') throw new Error(`${label}.${key} 必须是字符串`)
    out[key] = entry
  }
  return out
}

/** meta：id 必填非空字符串；title/artist/source 允许缺省（按空串处理），给了就必须是字符串 */
function requireTrackMeta(value: unknown): { id: string } & CacheTrackMeta {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('meta 必须是包含 id/title/artist/source 的对象')
  }
  const v = value as Record<string, unknown>
  const text = (field: 'title' | 'artist' | 'source'): string => {
    const raw = v[field]
    if (raw == null) return ''
    if (typeof raw !== 'string') throw new Error(`meta.${field} 必须是字符串`)
    return raw
  }
  return {
    id: requireString(v.id, 'meta.id'),
    title: text('title'),
    artist: text('artist'),
    source: text('source'),
  }
}

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

  // ---- 离线缓存（讲求命中速度：lookup 只 stat，不做 sha256） ----
  ipcMain.handle('imusic:cacheLookup', (_e, id: unknown) => lookupCached(requireString(id, 'id')))
  ipcMain.handle('imusic:cacheList', () => listCached())
  ipcMain.handle('imusic:cacheRemove', (_e, id: unknown) =>
    removeCached(requireString(id, 'id')),
  )
  ipcMain.handle(
    'imusic:cacheDownload',
    async (_e, meta: unknown, url: unknown, headers: unknown) => {
      const track = requireTrackMeta(meta)
      return downloadToCache(
        track,
        requireString(url, 'url'),
        requireStringRecord(headers, 'headers'),
      )
    },
  )
}
