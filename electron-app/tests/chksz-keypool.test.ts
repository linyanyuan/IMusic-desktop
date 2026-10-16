// ChKSz Key 池 —— 轮询分摊 + 失效冷却（服务层行为锚点）。
//
// 池是纯逻辑（时间源可注入），所以用假时钟精确验证：轮询顺序、reportFailure 后跳过、
// 冷却到期恢复、全池冷却时取最早到期者、空池返回 null、setKeys 的规范化。

import assert from 'node:assert/strict'
import test from 'node:test'
import { CHKSZ_KEY_COOLDOWN_MS, ChkszKeyPool } from '../src/services/chkszKeyPool'

/** 手摇时钟：advance(ms) 推进 now()，避免测试依赖真实时间 */
function fakeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let current = start
  return {
    now: () => current,
    advance: (ms) => {
      current += ms
    },
  }
}

test('轮询取 key：按加入顺序循环，一轮用完后回到第一条', () => {
  const pool = new ChkszKeyPool()
  pool.setKeys(['a', 'b', 'c'])
  assert.equal(pool.size, 3)
  assert.equal(pool.acquire(), 'a')
  assert.equal(pool.acquire(), 'b')
  assert.equal(pool.acquire(), 'c')
  assert.equal(pool.acquire(), 'a')
})

test('setKeys 去空白、去重、丢空串，并重置轮询指针', () => {
  const pool = new ChkszKeyPool()
  pool.setKeys([' a ', 'b', 'a', '', '   ', 'c', 'b'])
  assert.equal(pool.size, 3)
  assert.equal(pool.acquire(), 'a')
  assert.equal(pool.acquire(), 'b')
  assert.equal(pool.acquire(), 'c')

  pool.setKeys(['x', 'y'])
  assert.equal(pool.size, 2)
  assert.equal(pool.acquire(), 'x', '替换后从第一条重新开始')
})

test('setKeys 列表未变时保留轮询指针（任何设置变更都会触发 setKeys）', () => {
  // runtime 订阅 AppSettings：主题/歌词字号等任意设置变更都会用同一列表再调 setKeys。
  // 若无条件重置指针，轮询就永远从第一条开始，池化分摊退化成单 key。
  const pool = new ChkszKeyPool()
  pool.setKeys(['a', 'b', 'c'])
  assert.equal(pool.acquire(), 'a')

  pool.setKeys(['a', 'b', 'c'])
  assert.equal(pool.acquire(), 'b', '同一列表再次 setKeys 不该把指针拨回第一条')

  pool.setKeys([' a ', 'b', 'c', 'a']) // 规范化后仍与当前列表相同
  assert.equal(pool.acquire(), 'c', '等价的列表同样不重置指针')

  pool.setKeys(['x', 'y'])
  assert.equal(pool.acquire(), 'x', '列表真的变了才重置指针')
})

test('空池 acquire 返回 null', () => {
  const pool = new ChkszKeyPool()
  assert.equal(pool.size, 0)
  assert.equal(pool.acquire(), null)

  pool.setKeys(['   ', ''])
  assert.equal(pool.size, 0)
  assert.equal(pool.acquire(), null, '只有空白/空串等于空池')
})

test('reportFailure 后跳过该 key，改用池内其他 key', () => {
  const pool = new ChkszKeyPool()
  pool.setKeys(['a', 'b'])
  assert.equal(pool.acquire(), 'a')
  pool.reportFailure('a')
  assert.equal(pool.acquire(), 'b', 'a 已冷却，必须换 b')
  assert.equal(pool.acquire(), 'b', '只剩 b 可用时一直给 b')
})

test('冷却到期后自动恢复可用（注入时钟）', () => {
  const clock = fakeClock(1000)
  const pool = new ChkszKeyPool({ cooldownMs: 1000, now: clock.now })
  pool.setKeys(['a', 'b'])

  pool.reportFailure('a')
  assert.equal(pool.acquire(), 'b')
  clock.advance(999)
  assert.equal(pool.acquire(), 'b', '冷却未到期仍跳过 a')
  clock.advance(1)
  assert.equal(pool.acquire(), 'a', '到期后 a 重新进入轮询')
})

test('reportSuccess 清除冷却标记', () => {
  const pool = new ChkszKeyPool({ now: fakeClock().now })
  pool.setKeys(['a', 'b'])
  pool.reportFailure('a')
  pool.reportSuccess('a')
  assert.equal(pool.acquire(), 'a', '清除冷却后 a 立即回到轮询序列')
})

test('全部在冷却期时返回冷却最早到期的那条（不是直接失败）', () => {
  const clock = fakeClock(0)
  const pool = new ChkszKeyPool({ cooldownMs: 1000, now: clock.now })
  pool.setKeys(['a', 'b'])

  pool.reportFailure('a') // a → 1000
  clock.advance(10)
  pool.reportFailure('b') // b → 1010

  assert.equal(pool.acquire(), 'a', 'a 更早到期')
  assert.equal(pool.acquire(), 'a', '全池冷却时持续给最早到期的 a')
  clock.advance(1000) // t=1010，两条都到期
  assert.equal(pool.acquire(), 'a')
})

test('从池中删掉冷却中的 key 后不会再被取到', () => {
  const pool = new ChkszKeyPool()
  pool.setKeys(['a', 'b'])
  pool.reportFailure('a')
  pool.setKeys(['b'])
  assert.equal(pool.size, 1)
  assert.equal(pool.acquire(), 'b')
})

test('默认冷却时长为 60 秒', () => {
  assert.equal(CHKSZ_KEY_COOLDOWN_MS, 60_000)
})
