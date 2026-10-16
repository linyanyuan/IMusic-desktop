// ChKSz key 热更新 —— 设置页改了 key 必须立即生效，不需要重启应用。
//
// 背景（用户反馈「配置 ChKSz key 后搜索功能没打通」）：createMusicService 原先在
// 构造时把 key 快照成实例，设置页后填的 key 根本不会生效（Dart 端由 Riverpod 的
// provider 重建天然生效，这是移植时丢掉的语义）。createChkszResolver 负责补回来。

import assert from 'node:assert/strict'
import test from 'node:test'
import { createChkszResolver } from '../src/services/chksz'
import { ChkszKeyPool } from '../src/services/chkszKeyPool'

test('未配置 key 时解析为 null（ChKSz 源不启用）', () => {
  const resolve = createChkszResolver(() => '')
  assert.equal(resolve(), null)
  assert.equal(resolve(), null)
})

test('后在设置页填入 key：同一个解析器立刻能给出 provider（无需重建服务）', () => {
  let key = ''
  const resolve = createChkszResolver(() => key)
  assert.equal(resolve(), null, '未配置时为 null')

  key = 'chksz_test_key_1'
  const provider = resolve()
  assert.notEqual(provider, null, '填了 key 之后必须立刻可用')
})

test('key 不变时复用同一实例（保留 provider 内的歌曲缓存）', () => {
  const resolve = createChkszResolver(() => 'k1')
  assert.equal(resolve(), resolve())
})

test('key 变化时换新实例，清空后回到 null', () => {
  let key = 'k1'
  const resolve = createChkszResolver(() => key)
  const first = resolve()
  key = 'k2'
  const second = resolve()
  assert.notEqual(first, second, '换 key 必须换实例（新 key 才能生效）')
  key = ''
  assert.equal(resolve(), null, '清空 key 后 ChKSz 源停用')
})

test('前后空白不影响判定（设置页容易粘进空格）', () => {
  const resolve = createChkszResolver(() => '  k1  ')
  assert.notEqual(resolve(), null)
  const resolveBlank = createChkszResolver(() => '   ')
  assert.equal(resolveBlank(), null)
})

test('Key 池非空时解析出 provider（即使没有单 key）', () => {
  const pool = new ChkszKeyPool()
  const resolve = createChkszResolver(() => '', { keyPool: pool })
  assert.equal(resolve(), null, '空池 + 无单 key → ChKSz 源停用')

  pool.setKeys(['k1'])
  const provider = resolve()
  assert.notEqual(provider, null, '池里有 key 就必须可用')
  assert.equal(resolve(), provider, '池模式复用同一实例（池就地更新，不重建服务）')
})

test('池清空后单 key 恰好等于旧哨兵字符串也能正确切换（不再共用取值空间）', () => {
  // 回归：原先用哨兵字符串 '__chksz_key_pool__' 与真实 key 共用取值空间，
  // 真实 key 恰为该串时 next !== identity 不成立 → provider 永不重建。
  const pool = new ChkszKeyPool()
  pool.setKeys(['k1'])
  const single = '__chksz_key_pool__'
  const resolve = createChkszResolver(() => single, { keyPool: pool })
  const fromPool = resolve()
  assert.notEqual(fromPool, null)

  pool.setKeys([])
  const fromSingle = resolve()
  assert.notEqual(fromSingle, null, '单 key 模式下 key 非空就要可用')
  assert.notEqual(fromSingle, fromPool, '池清空后必须换成单 key 实例')

  pool.setKeys(['k2'])
  assert.notEqual(resolve(), fromSingle, '池重新填上后必须切回池实例')
})

test('池清空后回落到单 key provider，单 key 也清空则回到 null', () => {
  const pool = new ChkszKeyPool()
  pool.setKeys(['k1'])
  let single = 'builtin'
  const resolve = createChkszResolver(() => single, { keyPool: pool })
  const fromPool = resolve()

  pool.setKeys([])
  const fromSingle = resolve()
  assert.notEqual(fromPool, fromSingle, '池清空后换成单 key 实例')

  single = ''
  assert.equal(resolve(), null, '两者都没了才停用 ChKSz')
})
