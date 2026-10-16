// 离线缓存元数据索引（cache-index.json）的纯函数回归。
//
// 索引读写函数都显式接收缓存目录，所以这里能在 os.tmpdir() 的临时目录里直接测，
// 完全不碰 app.getPath —— require('electron') 在纯 node 下只是个可执行文件路径字符串，
// 调 app.getPath 会崩，因此测的只能是 cacheDir() 之外的那一层。
//
// 覆盖：upsert 后读回、损坏 JSON / 结构不符的容忍、prune 剔除已消失的文件、
// removeCachedIn 的「文件 + receipt + 索引项」三联动、lookupCachedIn 的轻量命中、
// writeCacheIndex 的原子替换（不留 .tmp）、批量删除索引项、clearExpired 的批量清理。

import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  CACHE_INDEX_FILE,
  CACHE_INDEX_TMP_FILE,
  audioUrlFor,
  cacheIndexPathIn,
  cacheKeyFor,
  cachePathForTokenIn,
  clearCache,
  clearExpired,
  listCachedIn,
  lookupCachedIn,
  readCacheIndex,
  removeCacheIndexEntries,
  removeCacheIndexEntry,
  removeCachedIn,
  pruneCacheIndex,
  setCacheDirectory,
  upsertCacheIndexEntry,
  writeCacheIndex,
  type CachedTrack,
} from '../electron/audioCache'

const DAY_MS = 24 * 60 * 60 * 1000

/** 目录里是否残留 .tmp 之类的临时文件（原子写后不该有） */
function tmpLeftovers(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.tmp'))
}

/** 每个用例一个独立临时目录；返回目录与一个收尾用的清理函数 */
function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'imusic-cache-index-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function track(id: string, overrides: Partial<CachedTrack> = {}): CachedTrack {
  return {
    id,
    title: '标题',
    artist: '歌手',
    source: 'netease',
    bytes: 1024,
    cachedAt: 1_700_000_000_000,
    ...overrides,
  }
}

/** 造一个假的已缓存文件（内容非空即可，命中检查只看 size） */
function writeFakeAudio(dir: string, id: string, bytes = 1024): string {
  const p = cachePathForTokenIn(dir, cacheKeyFor(id))
  writeFileSync(p, Buffer.alloc(bytes, 7))
  return p
}

test('upsert 后能读回，并落盘到 cache-index.json', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    const entry = track('netease:1')
    upsertCacheIndexEntry(dir, cacheKeyFor('netease:1'), entry)

    assert.deepEqual(readCacheIndex(dir)[cacheKeyFor('netease:1')], entry)

    const raw = readFileSync(cacheIndexPathIn(dir), 'utf8')
    assert.ok(raw.includes('netease:1'), '索引文件里应能直接看到 id')
    assert.deepEqual(JSON.parse(raw), { [cacheKeyFor('netease:1')]: entry })
  } finally {
    cleanup()
  }
})

test('upsert 幂等：同一 key 重复写只保留一条且为最新值', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    const key = cacheKeyFor('netease:2')
    upsertCacheIndexEntry(dir, key, track('netease:2', { bytes: 1 }))
    upsertCacheIndexEntry(dir, key, track('netease:2', { bytes: 2, title: '新标题' }))

    const index = readCacheIndex(dir)
    assert.deepEqual(Object.keys(index), [key])
    assert.equal(index[key].bytes, 2)
    assert.equal(index[key].title, '新标题')
  } finally {
    cleanup()
  }
})

test('索引文件缺失按空索引处理，不抛', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    assert.deepEqual(readCacheIndex(dir), {})
    assert.equal(existsSync(cacheIndexPathIn(dir)), false, '读操作不应顺手创建文件')
  } finally {
    cleanup()
  }
})

test('索引 JSON 损坏 / 结构不符一律容错为空索引', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    const cases = [
      '{ 这不是 json',
      '[]',
      '"字符串"',
      'null',
      JSON.stringify({ abc: { id: 'x', title: 'y' } }), // 字段不全
      JSON.stringify({ abc: '字符串不是对象' }),
    ]
    for (const raw of cases) {
      writeFileSync(cacheIndexPathIn(dir), raw, 'utf8')
      assert.deepEqual(readCacheIndex(dir), {}, `应容忍：${raw}`)
    }

    // 结构不符的条目被剔除，合法的留下
    writeFileSync(
      cacheIndexPathIn(dir),
      JSON.stringify({ bad: { id: 1 }, good: track('netease:3') }),
      'utf8',
    )
    const index = readCacheIndex(dir)
    assert.deepEqual(Object.keys(index), ['good'])
  } finally {
    cleanup()
  }
})

test('pruneCacheIndex 剔除文件已不在/为空的项并落盘', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    const keyAlive = cacheKeyFor('alive')
    const keyGone = cacheKeyFor('gone')
    const keyEmpty = cacheKeyFor('empty')
    writeFakeAudio(dir, 'alive', 512)
    writeFakeAudio(dir, 'empty', 0)
    for (const id of ['alive', 'gone', 'empty']) {
      upsertCacheIndexEntry(dir, cacheKeyFor(id), track(id))
    }

    const pruned = readCacheIndex(dir) // 先确认三条都在
    assert.equal(Object.keys(pruned).length, 3)

    const kept = pruneCacheIndex(dir)
    assert.deepEqual(Object.keys(kept), [keyAlive])
    assert.deepEqual(Object.keys(readCacheIndex(dir)), [keyAlive], '剔除结果应已落盘')
    assert.equal(existsSync(cachePathForTokenIn(dir, keyGone)), false)

    // 0 字节也算无效
    assert.equal(keyEmpty in kept, false)
  } finally {
    cleanup()
  }
})

test('removeCacheIndexEntry 只删指定项', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    const keyA = cacheKeyFor('a')
    const keyB = cacheKeyFor('b')
    upsertCacheIndexEntry(dir, keyA, track('a'))
    upsertCacheIndexEntry(dir, keyB, track('b'))

    removeCacheIndexEntry(dir, keyA)
    assert.deepEqual(Object.keys(readCacheIndex(dir)), [keyB])

    // 删不存在的项不抛、不改变内容
    removeCacheIndexEntry(dir, keyA)
    assert.deepEqual(Object.keys(readCacheIndex(dir)), [keyB])
  } finally {
    cleanup()
  }
})

test('lookupCachedIn：只有「文件存在且 size>0」才算命中，命中给出协议 URL', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    assert.equal(lookupCachedIn(dir, 'netease:miss'), null)

    writeFakeAudio(dir, 'netease:hit', 2048)
    assert.deepEqual(lookupCachedIn(dir, 'netease:hit'), {
      url: audioUrlFor('netease:hit'),
      bytes: 2048,
    })

    writeFakeAudio(dir, 'netease:empty', 0)
    assert.equal(lookupCachedIn(dir, 'netease:empty'), null)
  } finally {
    cleanup()
  }
})

test('lookupCachedIn 不依赖索引（旧缓存文件无索引项也能命中）', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    writeFakeAudio(dir, 'legacy', 64)
    assert.deepEqual(readCacheIndex(dir), {})
    assert.deepEqual(lookupCachedIn(dir, 'legacy'), { url: audioUrlFor('legacy'), bytes: 64 })
  } finally {
    cleanup()
  }
})

test('removeCachedIn 联动：缓存文件 + receipt + 索引项一起删，返回值反映曾经是否存在', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    const id = 'netease:rm'
    const filePath = writeFakeAudio(dir, id, 32)
    const receiptPath = `${filePath}.sha256`
    writeFileSync(receiptPath, 'deadbeef', 'utf8')
    upsertCacheIndexEntry(dir, cacheKeyFor(id), track(id))
    assert.equal(statSync(filePath).size, 32)

    assert.equal(removeCachedIn(dir, id), true)
    assert.equal(existsSync(filePath), false, '缓存文件应被删除')
    assert.equal(existsSync(receiptPath), false, 'receipt 应被删除')
    assert.equal(cacheKeyFor(id) in readCacheIndex(dir), false, '索引项应被删除')

    // 再删一次：文件已不在，返回 false 且不抛
    assert.equal(removeCachedIn(dir, id), false)
  } finally {
    cleanup()
  }
})

test('removeCachedIn 删掉最后一项后索引里不留残壳', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    const id = 'only'
    writeFakeAudio(dir, id, 8)
    upsertCacheIndexEntry(dir, cacheKeyFor(id), track(id))
    removeCachedIn(dir, id)
    assert.deepEqual(readCacheIndex(dir), {})
  } finally {
    cleanup()
  }
})

test('listCachedIn：按 cachedAt 倒序，文件已不在的项从索引剔除且不返回', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    writeFakeAudio(dir, 'old', 10)
    writeFakeAudio(dir, 'new', 20)
    upsertCacheIndexEntry(dir, cacheKeyFor('old'), track('old', { cachedAt: 1000 }))
    upsertCacheIndexEntry(dir, cacheKeyFor('gone'), track('gone', { cachedAt: 2000 }))
    upsertCacheIndexEntry(dir, cacheKeyFor('new'), track('new', { cachedAt: 3000 }))

    const list = listCachedIn(dir)
    assert.deepEqual(
      list.map((entry) => entry.id),
      ['new', 'old'],
      '缺失文件的项不返回，且按入库时间倒序',
    )
    assert.deepEqual(Object.keys(readCacheIndex(dir)).sort(), [
      cacheKeyFor('new'),
      cacheKeyFor('old'),
    ])
    assert.equal(existsSync(cacheIndexPathIn(dir)), true)
  } finally {
    cleanup()
  }
})

test('CACHE_INDEX_FILE 是缓存目录下的普通文件名（不是绝对路径）', () => {
  assert.equal(CACHE_INDEX_FILE, 'cache-index.json')
  const { dir, cleanup } = makeTempDir()
  try {
    assert.equal(cacheIndexPathIn(dir), join(dir, 'cache-index.json'))
  } finally {
    cleanup()
  }
})

// ---------------- 原子写（崩溃不截断索引） ----------------

test('writeCacheIndex 原子写：临时文件不残留，中文标题/歌手原样读回', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    const key = cacheKeyFor('netease:中文')
    const entry = track('netease:中文', {
      title: '夜曲（Live）',
      artist: '周杰伦 / 五月天',
      bytes: 4096,
    })
    writeCacheIndex(dir, { [key]: entry })

    assert.deepEqual(tmpLeftovers(dir), [], '写完后目录里不应留 .tmp')
    assert.deepEqual(readCacheIndex(dir), { [key]: entry })
    assert.deepEqual(JSON.parse(readFileSync(cacheIndexPathIn(dir), 'utf8')), {
      [key]: entry,
    })

    // 覆盖写（第二次）也不留残file，且内容整体替换
    writeCacheIndex(dir, { [key]: { ...entry, bytes: 8192 } })
    assert.deepEqual(tmpLeftovers(dir), [])
    assert.equal(readCacheIndex(dir)[key].bytes, 8192)
  } finally {
    cleanup()
  }
})

// ---------------- 批量删（清理过期批量落盘） ----------------

test('removeCacheIndexEntries 批量删：只留未命中的项，且不留 .tmp', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    const keyA = cacheKeyFor('expired-a')
    const keyB = cacheKeyFor('expired-b')
    const keyKeep = cacheKeyFor('keep')
    const keepEntry = track('keep', { cachedAt: 500 })
    writeCacheIndex(dir, {
      [keyA]: track('expired-a'),
      [keyB]: track('expired-b'),
      [keyKeep]: keepEntry,
    })

    const removed = removeCacheIndexEntries(dir, [keyA, keyB])
    assert.equal(removed, 2)
    const index = readCacheIndex(dir)
    assert.deepEqual(Object.keys(index), [keyKeep])
    assert.deepEqual(index[keyKeep], keepEntry, '保留项元数据应原样不动')
    assert.deepEqual(tmpLeftovers(dir), [])
    assert.equal(existsSync(join(dir, CACHE_INDEX_TMP_FILE)), false)
  } finally {
    cleanup()
  }
})

test('removeCacheIndexEntries：空列表或不命中任何项时不写盘、不创建索引文件', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    assert.equal(removeCacheIndexEntries(dir, []), 0)
    assert.equal(removeCacheIndexEntries(dir, [cacheKeyFor('从来没有过')]), 0)
    assert.equal(existsSync(cacheIndexPathIn(dir)), false, '没东西可删就不该落盘')
    assert.deepEqual(readdirSync(dir), [])
  } finally {
    cleanup()
  }
})

// ---------------- clearExpired 的批量清理 ----------------
//
// clearExpired / clearCache 走的是 cacheDir()，纯 node 下 app.getPath 会崩；
// 但 setCacheDirectory 给了非空目录时不会碰 app，所以能在这里用临时目录测。
// directoryOverride 是模块级状态且不还原，下面的用例都各自 setCacheDirectory 到自己的临时目录。

test('clearExpired 批量清过期项：保留项元数据不受影响', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    setCacheDirectory(dir)

    const oldAge = new Date(Date.now() - 10 * DAY_MS)
    const expiredPaths = ['old-1', 'old-2'].map((id) => {
      const p = writeFakeAudio(dir, id, 16)
      writeFileSync(`${p}.sha256`, 'deadbeef', 'utf8')
      utimesSync(p, oldAge, oldAge)
      return p
    })
    const keepPath = writeFakeAudio(dir, 'keep', 32)
    const keepEntry = track('keep', {
      title: '保留曲目',
      artist: '保留歌手',
      bytes: 32,
      cachedAt: 1_700_000_000_000,
    })
    writeCacheIndex(dir, {
      [cacheKeyFor('old-1')]: track('old-1', { cachedAt: 1 }),
      [cacheKeyFor('old-2')]: track('old-2', { cachedAt: 2 }),
      [cacheKeyFor('keep')]: keepEntry,
    })

    const { removed } = clearExpired(7 * DAY_MS)
    assert.equal(removed, 2)

    for (const p of expiredPaths) {
      assert.equal(existsSync(p), false, '过期缓存文件应被删除')
      assert.equal(existsSync(`${p}.sha256`), false, '过期 receipt 应被删除')
    }
    assert.equal(existsSync(keepPath), true, '未过期文件应保留')

    const index = readCacheIndex(dir)
    assert.deepEqual(Object.keys(index), [cacheKeyFor('keep')])
    assert.deepEqual(index[cacheKeyFor('keep')], keepEntry, '保留项元数据应原样不动')
    assert.deepEqual(tmpLeftovers(dir), [])

    // 没有过期项时也不该重写索引（这里只断言可观测结果：内容仍一致）
    assert.deepEqual(clearExpired(7 * DAY_MS), { removed: 0 })
    assert.deepEqual(readCacheIndex(dir), index)
  } finally {
    cleanup()
  }
})

test('clearCache 连残留的 cache-index.json.tmp 一起清掉，不留垃圾', () => {
  const { dir, cleanup } = makeTempDir()
  try {
    setCacheDirectory(dir)

    const audioPath = writeFakeAudio(dir, 'track', 128)
    writeFileSync(`${audioPath}.sha256`, 'deadbeef', 'utf8')
    writeCacheIndex(dir, { [cacheKeyFor('track')]: track('track') })
    // 模拟一次写索引中途崩溃/被杀留下的临时文件
    writeFileSync(join(dir, CACHE_INDEX_TMP_FILE), '{ 半截', 'utf8')

    const stats = clearCache()
    assert.equal(stats.removed, 1)
    assert.equal(stats.freedBytes, 128)
    assert.deepEqual(readdirSync(dir), [], '缓存目录应被清空（含 .tmp 与索引文件）')
    assert.equal(existsSync(cacheIndexPathIn(dir)), false)
  } finally {
    cleanup()
  }
})
