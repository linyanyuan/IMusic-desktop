// 安装包差量下载的执行层（electron/differentialDownload.ts）。
//
// 这里锁的是「把 blockmap 差异真正拼成文件」这一段：拷贝/下载的落盘是否逐字节正确、
// 收益阈值是否拒绝无意义的差量、异常与取消是否不留下半截 .part。算法本身（块比对）
// 的用例在 tests/blockmap-diff.test.ts，这里只用它的 parseBlockmap/computeDiffOperations
// 造数据。
//
// 刻意走**真实文件 + 真实 gzip**：差量更新的价值全在 IO 上，用假的 fs 抽象就等于
// 没测。fetchRange 是唯一注入点（对应 update.ts 里的 HTTP Range 请求）。

import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { downloadDifferential } from '../electron/differentialDownload'
import { parseBlockmap } from '../electron/blockmapDiff'

/**
 * 造一块内容：用 tag 重复填充到 size 字节。
 *
 * 块大小**刻意各不相同**：真实 blockmap 的块是变长的（实测 8KB~64KB），固定网格会
 * 掩盖「偏移按 sizes 累加」这类错误。
 */
function block(tag: string, size: number): string {
  assert.ok(tag.length > 0, 'tag 不能为空')
  return tag.repeat(Math.ceil(size / tag.length)).slice(0, size)
}

interface Fixture {
  /** 安装包明文 */
  data: Buffer
  /** 该安装包的 .blockmap 原始字节（真实 gzip JSON） */
  blockmap: Uint8Array
  sizes: number[]
}

/**
 * 由「每块内容」造出一个安装包 + 其 blockmap。
 *
 * ⚠️ checksum 是**测试替身**：真实 blockmap 里是块内容 blake2b-18 的 base64，而这里
 * 直接拿块内容本身当 checksum（与 tests/blockmap-diff.test.ts 同一手法）。算法只依赖
 * 「内容相同 ⇒ checksum 相同」，这个替身天然满足。
 */
function mkFixture(chunks: string[], offset = 0): Fixture {
  const data = Buffer.from(chunks.join(''), 'utf8')
  const sizes = chunks.map((chunk) => Buffer.byteLength(chunk, 'utf8'))
  const json = JSON.stringify({
    version: '2',
    files: [
      {
        name: 'IMusic-Setup-x64.exe',
        offset,
        sizes,
        checksums: chunks,
      },
    ],
  })
  return { data, blockmap: new Uint8Array(gzipSync(Buffer.from(json, 'utf8'))), sizes }
}

/** 每个用例一个临时目录，结束即删。 */
async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'imusic-diffdl-'))
  try {
    await run(dir)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 造一段「本地旧安装包」并返回路径。 */
async function writeOldInstaller(dir: string, old: Fixture): Promise<string> {
  const oldPath = path.join(dir, 'installer-old.exe')
  await fsp.writeFile(oldPath, old.data)
  return oldPath
}

test('能逐字节重建：只下载变化的块，其余从旧包拷贝', async () => {
  await withTempDir(async (dir) => {
    const oldChunks = [
      block('a', 1000),
      block('b', 2000),
      block('c', 5000),
      block('d', 3000),
      block('e', 4000),
      block('f', 2500),
      block('g', 1500),
    ]
    // 第 2、5 块（1 基）内容变了 —— 与真实的「改了点代码只需要重下几个块」一致性最好
    const newChunks = [...oldChunks]
    newChunks[1] = block('B2', 2000)
    newChunks[4] = block('E5', 4000)

    const old = mkFixture(oldChunks)
    const next = mkFixture(newChunks)
    const oldInstallerPath = await writeOldInstaller(dir, old)
    const targetPath = path.join(dir, 'new.exe.part')

    const requested: Array<[number, number]> = []
    const progress: Array<{ received: number; total: number }> = []

    const outcome = await downloadDifferential({
      oldInstallerPath,
      oldBlockmapRaw: old.blockmap,
      newBlockmapRaw: next.blockmap,
      targetPath,
      fetchRange: async (start, end) => {
        requested.push([start, end])
        // 故意返回**视图**（byteOffset 非 0），覆盖「不能假设 byteOffset === 0」的实现细节
        return next.data.subarray(start, end + 1)
      },
      onProgress: (received, total) => progress.push({ received, total }),
    })

    assert.equal(outcome.ok, true, `差量下载应当成功：${JSON.stringify(outcome)}`)
    if (!outcome.ok) return

    const written = await fsp.readFile(targetPath)
    assert.equal(Buffer.compare(written, next.data), 0, '输出必须与新安装包逐字节相同')
    assert.equal(sha256(written), sha256(next.data))

    // 只下了变掉的两块：2000 + 4000
    assert.equal(outcome.downloaded, 2000 + 4000)
    assert.equal(outcome.total, next.data.byteLength)
    assert.equal(outcome.operations, 5, 'copy/download/copy/download/copy 共 5 段')
    assert.equal(requested.length, 2, '只有两个下载区间，不该整包重下')

    const last = progress[progress.length - 1]
    assert.ok(last != null)
    assert.equal(last.received, next.data.byteLength, '最后一次进度的 received 必须是整包大小')
    assert.equal(last.total, next.data.byteLength)
  })
})

test('新旧完全相同：一个字节都不下载，输出仍逐字节相同', async () => {
  await withTempDir(async (dir) => {
    const chunks = [block('a', 4096), block('b', 8192), block('c', 1000)]
    const old = mkFixture(chunks)
    const next = mkFixture(chunks)
    const oldInstallerPath = await writeOldInstaller(dir, old)
    const targetPath = path.join(dir, 'new.exe.part')

    let fetchCalls = 0
    const outcome = await downloadDifferential({
      oldInstallerPath,
      oldBlockmapRaw: old.blockmap,
      newBlockmapRaw: next.blockmap,
      targetPath,
      fetchRange: async (start, end) => {
        fetchCalls += 1
        return next.data.subarray(start, end + 1)
      },
    })

    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    // 0 字节下载当然低于 60% 阈值，要走「收益足够」的分支（不是被阈值拒掉）
    assert.equal(outcome.downloaded, 0)
    assert.equal(outcome.operations, 1, '整份文件合成一段 copy')
    assert.equal(fetchCalls, 0, '不该发起任何网络请求')
    assert.equal(Buffer.compare(await fsp.readFile(targetPath), next.data), 0)
  })
})

test('收益不足：每块都变了 → 拒绝差量，且一次请求都不发', async () => {
  await withTempDir(async (dir) => {
    const old = mkFixture([block('a', 4096), block('b', 4096), block('c', 4096)])
    const next = mkFixture([block('x', 4096), block('y', 4096), block('z', 4096)])
    const oldInstallerPath = await writeOldInstaller(dir, old)
    const targetPath = path.join(dir, 'new.exe.part')

    let fetchCalls = 0
    const outcome = await downloadDifferential({
      oldInstallerPath,
      oldBlockmapRaw: old.blockmap,
      newBlockmapRaw: next.blockmap,
      targetPath,
      fetchRange: async (start, end) => {
        fetchCalls += 1
        return next.data.subarray(start, end + 1)
      },
    })

    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.match(outcome.reason, /收益不足/)
    assert.match(outcome.reason, /100%/)
    assert.equal(fetchCalls, 0, '收益不足必须在任何下载发生之前就放弃')
  })
})

test('blockmap 解析失败：返回失败原因，不抛异常', async () => {
  await withTempDir(async (dir) => {
    const old = mkFixture([block('a', 4096), block('b', 4096)])
    const oldInstallerPath = await writeOldInstaller(dir, old)
    const targetPath = path.join(dir, 'new.exe.part')

    const outcome = await downloadDifferential({
      oldInstallerPath,
      oldBlockmapRaw: old.blockmap,
      newBlockmapRaw: Buffer.from('nope', 'utf8'),
      targetPath,
      fetchRange: async () => {
        throw new Error('不该被调用')
      },
    })

    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.match(outcome.reason, /blockmap 解析失败/)
  })
})

test('区间字节数不符：失败且不留下半截 .part', async () => {
  await withTempDir(async (dir) => {
    const old = mkFixture([block('a', 4096), block('b', 4096), block('c', 4096)])
    const next = mkFixture([block('a', 4096), block('X', 4096), block('c', 4096)])
    const oldInstallerPath = await writeOldInstaller(dir, old)
    const targetPath = path.join(dir, 'new.exe.part')

    const outcome = await downloadDifferential({
      oldInstallerPath,
      oldBlockmapRaw: old.blockmap,
      newBlockmapRaw: next.blockmap,
      targetPath,
      // 少给 1 字节：模拟代理/服务器截断响应体
      fetchRange: async (start, end) => new Uint8Array(end - start),
    })

    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.match(outcome.reason, /字节数不符/)

    const leftover = await fsp.stat(targetPath).catch(() => null)
    assert.ok(leftover == null || leftover.size === 0, '失败时不能留下半写的安装包')
  })
})

test('覆盖不连续：blockmap 的 offset 不是 0 时拒绝组装（宁可回退全量）', async () => {
  // 覆盖完整性校验在这里是**可达**的：新 blockmap 声明 offset=100 时，操作表从 100
  // 开始，而拼接游标从 0 起算 —— 拼出来的文件头部会缺 100 字节，必须拒绝。
  // （其余「覆盖不连续」的情形由 computeDiffOperations 的单测保证不会产生。）
  await withTempDir(async (dir) => {
    const old = mkFixture([block('a', 4096), block('b', 4096)])
    const next = mkFixture([block('a', 4096), block('X', 4096)], 100)
    const oldInstallerPath = await writeOldInstaller(dir, old)
    const targetPath = path.join(dir, 'new.exe.part')

    let fetchCalls = 0
    const outcome = await downloadDifferential({
      oldInstallerPath,
      oldBlockmapRaw: old.blockmap,
      newBlockmapRaw: next.blockmap,
      targetPath,
      fetchRange: async (start, end) => {
        fetchCalls += 1
        return next.data.subarray(start, end + 1)
      },
    })

    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.match(outcome.reason, /差量区间不连续/)
    assert.equal(fetchCalls, 0)
    const leftover = await fsp.stat(targetPath).catch(() => null)
    assert.ok(leftover == null || leftover.size === 0)
  })
})

test('取消：第一次 fetchRange 时就 abort → 失败原因写明「已取消」', async () => {
  await withTempDir(async (dir) => {
    const old = mkFixture([block('a', 4096), block('b', 4096), block('c', 4096)])
    const next = mkFixture([block('a', 4096), block('X', 4096), block('c', 4096)])
    const oldInstallerPath = await writeOldInstaller(dir, old)
    const targetPath = path.join(dir, 'new.exe.part')

    const controller = new AbortController()
    const outcome = await downloadDifferential({
      oldInstallerPath,
      oldBlockmapRaw: old.blockmap,
      newBlockmapRaw: next.blockmap,
      targetPath,
      signal: controller.signal,
      fetchRange: async () => {
        controller.abort()
        return next.data.subarray(4096, 8192)
      },
    })

    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.match(outcome.reason, /取消/)
    const leftover = await fsp.stat(targetPath).catch(() => null)
    assert.ok(leftover == null || leftover.size === 0, '取消后不能留下半写的安装包')
  })
})

test('旧安装包被截断：读到的字节不足时报错而不是静默拼出坏包', async () => {
  await withTempDir(async (dir) => {
    const old = mkFixture([block('a', 4096), block('b', 4096)])
    const next = mkFixture([block('a', 4096), block('X', 4096)])
    // 只写前半段，模拟「上次更新只下了一半 / 用户手工删了文件尾部」
    const truncated = path.join(dir, 'installer-old.exe')
    await fsp.writeFile(truncated, old.data.subarray(0, 100))

    const outcome = await downloadDifferential({
      oldInstallerPath: truncated,
      oldBlockmapRaw: old.blockmap,
      newBlockmapRaw: next.blockmap,
      targetPath: path.join(dir, 'new.exe.part'),
      fetchRange: async (start, end) => next.data.subarray(start, end + 1),
    })

    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.match(outcome.reason, /旧安装包内容不足/)
  })
})

test('parseBlockmap 能读回本用例造出的 gzip blockmap（夹具本身有效）', async () => {
  const fixture = mkFixture([block('a', 1000), block('b', 2000)])
  const parsed = parseBlockmap(fixture.blockmap)
  assert.ok(parsed != null)
  assert.equal(parsed.totalSize, fixture.data.byteLength)
  assert.deepEqual(parsed.file.sizes, fixture.sizes)
})
