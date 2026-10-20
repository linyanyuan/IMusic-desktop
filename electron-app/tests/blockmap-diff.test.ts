// 安装包差量更新的块比对算法（electron/blockmapDiff.ts）。
//
// 背景：electron-builder 每次打包产出的 `IMusic-Setup-<版本>-x64.exe.blockmap` 是 gzip 压缩的
// JSON，里面给每个变长块（实测 8KB~64KB 不等）一个 blake2b-18 checksum。旧包与新包的 blockmap
// 一比，就能得出「哪些块本地已有、哪些块必须下载」。这里锁的是**纯算法**：解析器的防御性、
// copy/download 的切分与合并规则、以及 size 不匹配时不要误拷。

import assert from 'node:assert/strict'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import {
  computeDiffOperations,
  downloadBytes,
  parseBlockmap,
  type DiffOperation,
  type ParsedBlockmap,
} from '../electron/blockmapDiff'

const BS = 64 * 1024

/** 造一块内容：用 tag 重复填充到 size 字节。 */
function block(tag: string, size = BS): string {
  assert.ok(tag.length > 0, 'tag 不能为空')
  return tag.repeat(Math.ceil(size / tag.length)).slice(0, size)
}

/**
 * 造一个 blockmap。
 *
 * ⚠️ 这里是**测试替身**：真实的 `checksums` 是块内容 blake2b-18 的 base64，而这里直接拿
 * **块内容本身**当 checksum。这样「内容相同 ⇒ checksum 相同、内容不同 ⇒ checksum 不同」这一
 * 唯一被算法依赖的性质天然成立，测试读起来也不用对着 40 个随机字符猜哪块是哪块。
 */
function mkBlockmap(
  chunks: string[],
  blockSize = BS,
  name = 'IMusic-Setup-x64.exe',
  offset = 0,
): ParsedBlockmap {
  const sizes: number[] = []
  const checksums: string[] = []
  for (const chunk of chunks) {
    assert.ok(chunk.length > 0, '块内容不能为空（sizes 元素必须 > 0）')
    assert.ok(chunk.length <= blockSize, '块内容长度不能超过 blockSize')
    sizes.push(chunk.length)
    checksums.push(chunk)
  }
  return {
    version: '2',
    file: { name, offset, sizes, checksums },
    totalSize: offset + sizes.reduce((sum, size) => sum + size, 0),
  }
}

function copiesOf(operations: DiffOperation[]): Extract<DiffOperation, { type: 'copy' }>[] {
  return operations.filter((op): op is Extract<DiffOperation, { type: 'copy' }> => op.type === 'copy')
}

function downloadsOf(operations: DiffOperation[]): Extract<DiffOperation, { type: 'download' }>[] {
  return operations.filter(
    (op): op is Extract<DiffOperation, { type: 'download' }> => op.type === 'download',
  )
}

test('完全相同：只有一段 copy 覆盖全文件，下载量为 0', () => {
  const chunks = [block('a'), block('b'), block('c')]
  const oldMap = mkBlockmap(chunks)
  const newMap = mkBlockmap(chunks)
  const ops = computeDiffOperations(oldMap, newMap)

  assert.equal(ops.length, 1)
  const copy = copiesOf(ops)[0]
  assert.ok(copy != null)
  assert.equal(copy.sourceOffset, 0)
  assert.equal(copy.targetOffset, 0)
  assert.equal(copy.size, oldMap.totalSize)
  assert.equal(downloadsOf(ops).length, 0)
  assert.equal(downloadBytes(ops), 0)
})

test('完全不同：只有一个 download 区间覆盖全文件', () => {
  const oldMap = mkBlockmap([block('a'), block('b'), block('c')])
  const newMap = mkBlockmap([block('x'), block('y'), block('z')])
  const ops = computeDiffOperations(oldMap, newMap)

  assert.equal(ops.length, 1)
  assert.deepEqual(ops[0], { type: 'download', start: 0, end: newMap.totalSize - 1 })
  assert.equal(downloadBytes(ops), newMap.totalSize)
})

test('尾部追加：前 5 块 copy，最后 2 块合并成一段 download', () => {
  const head = [block('a'), block('b'), block('c'), block('d'), block('e')]
  const oldMap = mkBlockmap(head)
  const newMap = mkBlockmap([...head, block('f'), block('g')])
  const ops = computeDiffOperations(oldMap, newMap)

  assert.equal(ops.length, 2)
  assert.deepEqual(ops[0], {
    type: 'copy',
    sourceOffset: 0,
    targetOffset: 0,
    size: 5 * BS,
  })
  assert.deepEqual(ops[1], {
    type: 'download',
    start: 5 * BS,
    end: newMap.totalSize - 1,
  })
  assert.equal(newMap.totalSize, 7 * BS)
  assert.equal(downloadBytes(ops), 2 * BS)
})

test('中间替换：copy / download / copy 三段，第二段 copy 的 sourceOffset 指向旧文件', () => {
  const oldMap = mkBlockmap([block('a'), block('b'), block('c'), block('d'), block('e')])
  const newMap = mkBlockmap([block('a'), block('b'), block('X'), block('d'), block('e')])
  const ops = computeDiffOperations(oldMap, newMap)

  assert.deepEqual(ops, [
    // 前两块在旧文件里也是连续的 → 合并
    { type: 'copy', sourceOffset: 0, targetOffset: 0, size: 2 * BS },
    // 第 3 块内容变了 → 必须下载（start/end 都是含的字节索引）
    { type: 'download', start: 2 * BS, end: 3 * BS - 1 },
    // 后两块：targetOffset 与 sourceOffset 都连续 → 合并；sourceOffset 是**旧文件**的 3*BS
    { type: 'copy', sourceOffset: 3 * BS, targetOffset: 3 * BS, size: 2 * BS },
  ])

  // 再显式锁一次「不是把新文件偏移当成源偏移」这个坑
  const after = copiesOf(ops)[1]
  assert.ok(after != null)
  assert.equal(after.sourceOffset, 3 * BS)
  assert.equal(after.targetOffset, 3 * BS)
  assert.equal(downloadBytes(ops), BS)
})

test('同一 checksum 多候选且 size 不同：跳过 size 不匹配的，取第一个匹配的', () => {
  // 直接构造 ParsedBlockmap 字面量：模拟旧包里同一段内容出现两次、但两次声明的块大小不同
  // （例如内容相同但块边界不同）。候选表里先是 size=100 的，再是 size=BS 的。
  const dup = 'same-content'
  const oldMap: ParsedBlockmap = {
    version: '2',
    file: {
      name: 'old.exe',
      offset: 0,
      sizes: [100, BS],
      checksums: [dup, dup],
    },
    totalSize: 100 + BS,
  }
  const newMap: ParsedBlockmap = {
    version: '2',
    file: { name: 'new.exe', offset: 0, sizes: [BS], checksums: [dup] },
    totalSize: BS,
  }

  const ops = computeDiffOperations(oldMap, newMap)
  assert.deepEqual(ops, [{ type: 'copy', sourceOffset: 100, targetOffset: 0, size: BS }])
  assert.equal(downloadBytes(ops), 0)
})

test('parseBlockmap：gzip 与未压缩的 UTF-8 JSON 都能解析', () => {
  const json = JSON.stringify({
    version: '2',
    files: [
      {
        name: 'IMusic-Setup-2.3.13-x64.exe',
        offset: 0,
        sizes: [BS, 12345],
        checksums: ['c0', 'c1'],
      },
    ],
  })

  const fromGzip = parseBlockmap(gzipSync(Buffer.from(json, 'utf8')))
  assert.ok(fromGzip != null)
  assert.equal(fromGzip.version, '2')
  assert.equal(fromGzip.file.name, 'IMusic-Setup-2.3.13-x64.exe')
  assert.equal(fromGzip.file.offset, 0)
  assert.deepEqual(fromGzip.file.sizes, [BS, 12345])
  assert.deepEqual(fromGzip.file.checksums, ['c0', 'c1'])
  assert.equal(fromGzip.totalSize, BS + 12345)

  const fromPlain = parseBlockmap(Buffer.from(json, 'utf8'))
  assert.deepEqual(fromPlain, fromGzip)

  const fromString = parseBlockmap(json)
  assert.deepEqual(fromString, fromGzip)

  // 缺省字段：name 缺失 → ''，offset 缺失 → 0，version 缺失 → '2'
  const minimal = parseBlockmap('{"files":[{"sizes":[7],"checksums":["c"]}]}')
  assert.ok(minimal != null)
  assert.deepEqual(minimal.file, { name: '', offset: 0, sizes: [7], checksums: ['c'] })
  assert.equal(minimal.version, '2')
  assert.equal(minimal.totalSize, 7)
})

test('parseBlockmap：坏数据一律返回 null 且不抛异常', () => {
  const badInputs: Array<Uint8Array | string> = [
    'not json',
    '',
    'null',
    '[]',
    '{"files":[]}',
    '{"files":"nope"}',
    '{"files":[null]}',
    // sizes / checksums 长度不一致
    '{"files":[{"sizes":[1,2],"checksums":["a"]}]}',
    // size 非正
    '{"files":[{"sizes":[0],"checksums":["a"]}]}',
    // size 不是整数
    '{"files":[{"sizes":[1.5],"checksums":["a"]}]}',
    // size 不是数字
    '{"files":[{"sizes":["1"],"checksums":["a"]}]}',
    // checksum 是空字符串
    '{"files":[{"sizes":[1],"checksums":[""]}]}',
    // checksum 不是字符串
    '{"files":[{"sizes":[1],"checksums":[1]}]}',
    // offset 负数
    '{"files":[{"offset":-1,"sizes":[1],"checksums":["a"]}]}',
    // 截断的 gzip（magic bytes 后面什么都没有）
    Buffer.from([0x1f, 0x8b, 0, 0]),
    // 随机二进制
    Buffer.from([0x00, 0xff, 0x10, 0x7f, 0x80]),
  ]

  for (const input of badInputs) {
    const label = typeof input === 'string' ? input : Buffer.from(input).toString('hex')
    assert.equal(parseBlockmap(input), null, `应当返回 null: ${label}`)
  }
})

test('downloadBytes：只累加 download 区间，闭区间记账（含两端）', () => {
  // 手工构造：copy / download(0..99) / copy / download(200..299)
  const manual: DiffOperation[] = [
    { type: 'copy', sourceOffset: 0, targetOffset: 0, size: 100 },
    { type: 'download', start: 100, end: 199 },
    { type: 'copy', sourceOffset: 500, targetOffset: 200, size: 100 },
    { type: 'download', start: 300, end: 399 },
  ]
  assert.equal(downloadBytes(manual), 200)
  assert.equal(downloadBytes([]), 0)
  assert.equal(downloadBytes([{ type: 'copy', sourceOffset: 0, targetOffset: 0, size: 4096 }]), 0)

  // 单字节区间也要算 1 字节（end 是含的）
  assert.equal(downloadBytes([{ type: 'download', start: 7, end: 7 }]), 1)

  // 由比对结果算一遍
  const ops = computeDiffOperations(
    mkBlockmap([block('a'), block('b')]),
    mkBlockmap([block('a'), block('X'), block('b')]),
  )
  assert.equal(downloadBytes(ops), BS)
  assert.equal(downloadBytes(ops), downloadsOf(ops).reduce((sum, op) => sum + op.end - op.start + 1, 0))
})

test('变长块：偏移按 sizes 累加，不能靠「块号 × 常数」', () => {
  // 真实 blockmap 的块是**变长**的（实测 8KB~64KB 浮动），所以源/目标偏移必须一个个累加。
  const oldMap = mkBlockmap([block('a', 1000), block('b', 2000), block('c', 5000)])
  const newMap = mkBlockmap([block('a', 1000), block('X', 2000), block('c', 5000)])

  assert.deepEqual(oldMap.file.sizes, [1000, 2000, 5000])
  assert.deepEqual(computeDiffOperations(oldMap, newMap), [
    { type: 'copy', sourceOffset: 0, targetOffset: 0, size: 1000 },
    { type: 'download', start: 1000, end: 2999 },
    { type: 'copy', sourceOffset: 3000, targetOffset: 3000, size: 5000 },
  ])
})

test('offset 非 0：总大小与两端偏移都从 offset 起算', () => {
  // 真实 blockmap 的 offset 通常是 0，但算法里 offset 参与两边累加，锁一下免得退化成硬编码 0。
  const oldMap = mkBlockmap([block('a'), block('b')], BS, 'old.exe', 100)
  const newMap = mkBlockmap([block('a'), block('X')], BS, 'new.exe', 100)

  assert.equal(oldMap.totalSize, 100 + 2 * BS)
  assert.equal(newMap.totalSize, 100 + 2 * BS)

  const ops = computeDiffOperations(oldMap, newMap)
  assert.deepEqual(ops, [
    { type: 'copy', sourceOffset: 100, targetOffset: 100, size: BS },
    { type: 'download', start: 100 + BS, end: 100 + 2 * BS - 1 },
  ])
  assert.equal(downloadBytes(ops), BS)
})
