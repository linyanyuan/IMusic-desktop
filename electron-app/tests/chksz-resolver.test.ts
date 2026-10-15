// ChKSz key 热更新 —— 设置页改了 key 必须立即生效，不需要重启应用。
//
// 背景（用户反馈「配置 ChKSz key 后搜索功能没打通」）：createMusicService 原先在
// 构造时把 key 快照成实例，设置页后填的 key 根本不会生效（Dart 端由 Riverpod 的
// provider 重建天然生效，这是移植时丢掉的语义）。createChkszResolver 负责补回来。

import assert from 'node:assert/strict'
import test from 'node:test'
import { createChkszResolver } from '../src/services/chksz'

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
