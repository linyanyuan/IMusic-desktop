/**
 * 安装包差量更新：blockmap 块比对（纯算法，不改状态、不碰网络/磁盘）。
 *
 * ## 背景（实测）
 *
 * electron-builder 每次打包都会顺手产出
 * `IMusic-Setup-<版本>-x64.exe.blockmap`，它是一个 **gzip 压缩的 JSON**：
 *
 * ```json
 * { "version": "2",
 *   "files": [ { "name": "IMusic-Setup-2.3.13-x64.exe",
 *                "offset": 0,
 *                "sizes": [65536, 65536, ..., 12345],
 *                "checksums": ["<base64 12 字节>", ...] } ] }
 * ```
 *
 * `sizes[i]` 是第 i 块的字节数，`checksums[i]` 是该块内容的 blake2b-18（base64，12 字节 → 16 字符）。
 * 注意块大小**不是**固定的 64KiB 网格：实测 2.3.13 的安装包块长在 8KB~64KB 之间浮动（变长切块），
 * 所以块偏移只能由 `offset` + `sizes` 累加得出，绝不能拿「块序号 × 常数」去算。
 * 发布到 GitHub Release 的 `.blockmap` 与安装包一一对应。
 *
 * ## 这个模块做什么
 *
 * 给定旧版本 blockmap 与新版本 blockmap，算出「怎样把旧安装包拼成新安装包」的操作序列：
 * 哪些字节可以从本地旧包原样拷（`copy`），哪些必须从服务器下载（`download`）。
 * 实测 2.3.12 → 2.3.13 两个安装包（各约 84.1MB，8820 万字节、4200 多块）只有约 1.06MB 块内容
 * 变了，所以差量更新能把下载量压到 ~1.25%（实测数字见 tests 与发版记录）。
 *
 * ## 为什么不算 checksum
 *
 * **本模块不实现 blake2b**：`checksums` 被当作**不透明字符串**，只比较是否相等。
 * 这与实测语义一致 —— 同一块内容在新旧两个 blockmap 里给出的 checksum 字符串完全相同，
 * 所以「字符串相等 + size 相等」就足以判定「字节相同、可以拷」。
 * （真实的哈希由 electron-builder 与更新服务器各自负责，我们只做搬运。）
 *
 * ## 本模块不做的事
 *
 * - 不读旧安装包、不写新安装包、不发请求：只产出「操作表」给上层执行。
 * - 不 import electron：这样能被 `node --test` 直接单测（见 tests/blockmap-diff.test.ts）。
 */

import { gunzipSync } from 'node:zlib'

export interface BlockmapFileEntry {
  /** 文件名（仅用于诊断/日志） */
  name: string
  /** 该文件在 blockmap 意义上的起始偏移（通常为 0） */
  offset: number
  /** 每块字节数 */
  sizes: number[]
  /** 每块 checksum（base64 字符串，仅作不透明标识比较） */
  checksums: string[]
}

export interface ParsedBlockmap {
  version: string
  file: BlockmapFileEntry
  /** 整个文件总字节数（sizes 之和 + offset） */
  totalSize: number
}

export type DiffOperation =
  /** 从旧安装包的 `sourceOffset` 处拷 `size` 字节到新安装包的 `targetOffset`。 */
  | { type: 'copy'; sourceOffset: number; targetOffset: number; size: number }
  /** 从服务器下载新安装包的字节区间 `[start, end]`（两端都含）。 */
  | { type: 'download'; start: number; end: number }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 解出来的 JSON 根对象：结构校验在 `parseBlockmap` 里做，这里只负责「拿到 / 没拿到」。 */
type JsonRoot = Record<string, unknown>

/** 把一段文本按 JSON 解析出对象；不是 JSON 或根值不是对象都返回 `null`（不抛异常）。 */
function parseJsonObject(text: string): JsonRoot | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  return isPlainObject(parsed) ? parsed : null
}

/**
 * 把 .blockmap 的原始内容变成 JSON 根对象。
 * - Buffer / Uint8Array：优先按 gzip 解压（真实 .blockmap 就是 gzip JSON），失败再按 utf8 JSON 解析
 * - string：直接 JSON.parse
 * 解析失败返回 `null`。
 */
function decodeBlockmapPayload(raw: Uint8Array | string): JsonRoot | null {
  if (typeof raw === 'string') return parseJsonObject(raw)

  // 真实文件是 gzip；个别工具/中间产物可能写成未压缩的 JSON（curl -sL 落盘后被二次处理
  // 等），所以两条路都试。
  const bytes = Buffer.from(raw)
  try {
    const fromGzip = parseJsonObject(gunzipSync(bytes).toString('utf8'))
    if (fromGzip != null) return fromGzip
  } catch {
    // 不是合法 gzip → 落到下面按明文 JSON 再试一次。
  }
  return parseJsonObject(bytes.toString('utf8'))
}

/**
 * 解析 .blockmap 文件内容。
 * - Buffer / Uint8Array：优先按 gzip 解压（真实 .blockmap 就是 gzip JSON），失败再按 utf8 JSON 解析
 * - string：直接 JSON.parse
 *
 * 任何结构异常（非对象、`files` 不是数组、`files[0]` 缺字段、sizes/checksums 长度不一致、
 * 元素类型不对、负数等）一律返回 `null`，**绝不抛异常** —— 差量更新是「有则更快、无则回退
 * 全量」的可选优化，解析失败绝不能把更新流程炸掉。
 */
export function parseBlockmap(raw: Uint8Array | string): ParsedBlockmap | null {
  const root = decodeBlockmapPayload(raw)
  if (root == null) return null

  const files = root.files
  if (!Array.isArray(files) || files.length === 0) return null

  const head = files[0]
  if (!isPlainObject(head)) return null

  const sizes = head.sizes
  const checksums = head.checksums
  if (!Array.isArray(sizes) || !Array.isArray(checksums)) return null
  if (sizes.length === 0 || sizes.length !== checksums.length) return null

  const outSizes: number[] = []
  for (const size of sizes) {
    // 每块必须是不小于 1 的整数：0 长度块会让「按块切分」的偏移计算失真。
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) return null
    outSizes.push(size)
  }

  const outChecksums: string[] = []
  for (const checksum of checksums) {
    if (typeof checksum !== 'string' || checksum.length === 0) return null
    outChecksums.push(checksum)
  }

  const rawName = head.name
  const name = typeof rawName === 'string' ? rawName : ''

  const rawOffset = head.offset
  let offset = 0
  if (rawOffset !== undefined && rawOffset !== null) {
    if (typeof rawOffset !== 'number' || !Number.isInteger(rawOffset) || rawOffset < 0) return null
    offset = rawOffset
  }

  const version = typeof root.version === 'string' ? root.version : '2'

  const totalSize = outSizes.reduce((sum, size) => sum + size, offset)

  return { version, file: { name, offset, sizes: outSizes, checksums: outChecksums }, totalSize }
}

/** 旧包候选表里的一格：「内容在旧文件的哪里、有多大」。 */
interface Candidate {
  offset: number
  size: number
}

/**
 * 从候选数组里取一个 size 匹配的候选（取到即**消费掉**，从数组里移除）。
 *
 * - size 不匹配的候选**留在数组里**：同一个 checksum 在旧包里可能出现多次（内容相同的块
 *   出现在不同偏移），其中 size 不同说明它们其实是不同的块，后面别的新块可能正好需要它。
 * - 长度相同、内容相同即视为同一份字节（checksum 是内容摘要，size 相同才是同一段数据）。
 */
function takeCandidate(list: Candidate[] | undefined, size: number): Candidate | null {
  if (list == null) return null
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].size === size) return list.splice(i, 1)[0] ?? null
  }
  return null
}

/**
 * 计算把旧安装包变成新安装包所需的操作序列，**按 targetOffset 升序**。
 *
 * 规则：
 * - checksum 命中且 size 相同才能 `copy`；同一 checksum 在旧文件里可能出现多次，取第一个
 *   size 匹配的候选（见 `takeCandidate`）。
 * - 相邻的两段 `copy` **同时满足**「目标区间首尾相接」与「源区间首尾相接」才合并 ——
 *   即只有旧文件里也是连续的一段时才合成一次读，否则合成一条会让执行层做多次 seek，
 *   没有收益。**本实现选了这条严格规则**（tests/blockmap-diff.test.ts 有对应用例锁定）。
 * - 相邻的两段 `download` 只要目标区间首尾相接就合并成一个闭区间。
 */
export function computeDiffOperations(
  oldMap: ParsedBlockmap,
  newMap: ParsedBlockmap,
): DiffOperation[] {
  // 1. 旧文件的候选表：checksum -> 该内容在旧文件里的所有位置。
  const candidates = new Map<string, Candidate[]>()
  {
    let offset = oldMap.file.offset
    for (let i = 0; i < oldMap.file.sizes.length; i += 1) {
      const size = oldMap.file.sizes[i]
      const checksum = oldMap.file.checksums[i]
      const list = candidates.get(checksum)
      const candidate: Candidate = { offset, size }
      if (list == null) candidates.set(checksum, [candidate])
      else list.push(candidate)
      offset += size
    }
  }

  // 2. 逐块比对新文件。
  const operations: DiffOperation[] = []
  let targetOffset = newMap.file.offset
  for (let i = 0; i < newMap.file.sizes.length; i += 1) {
    const size = newMap.file.sizes[i]
    const source = takeCandidate(candidates.get(newMap.file.checksums[i]), size)
    if (source == null) {
      // 未命中：并入当前下载区间（或新开一段）。
      const start = targetOffset
      const end = targetOffset + size - 1
      const last = operations[operations.length - 1]
      if (last != null && last.type === 'download' && last.end + 1 === start) last.end = end
      else operations.push({ type: 'download', start, end })
    } else {
      const last = operations[operations.length - 1]
      if (
        last != null &&
        last.type === 'copy' &&
        last.targetOffset + last.size === targetOffset &&
        last.sourceOffset + last.size === source.offset
      ) {
        last.size += size
      } else {
        operations.push({ type: 'copy', sourceOffset: source.offset, targetOffset, size })
      }
    }
    targetOffset += size
  }

  return operations
}

/** 下载区间总字节数（诊断用：差量更新的收益就是它比 totalSize 小多少）。 */
export function downloadBytes(operations: DiffOperation[]): number {
  let total = 0
  for (const op of operations) {
    if (op.type === 'download') total += op.end - op.start + 1
  }
  return total
}
