// 视图前进/后退历史 —— 回归锚点。
//
// 语义与浏览器一致：新导航清前进栈；后退/前进对称移动；相同目标不入栈；
// 专注模式不进历史（由 route.tsx 的 toggleFocus 自己记来源）。

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canGoBack,
  canGoForward,
  emptyHistory,
  goBack,
  goForward,
  navigateTo,
  replaceCurrent,
} from '../src/state/history'

const eq = (a: string, b: string) => a === b

test('新导航：current 入后退栈，前进栈清空', () => {
  let h = emptyHistory('home')
  h = navigateTo(h, 'search', eq)
  assert.equal(h.current, 'search')
  assert.deepEqual(h.back, ['home'])
  assert.equal(canGoBack(h), true)
  assert.equal(canGoForward(h), false)
})

test('后退再前进能原路返回', () => {
  let h = emptyHistory('home')
  h = navigateTo(h, 'search', eq)
  h = navigateTo(h, 'playlistDetail', eq)
  const backed = goBack(h)
  assert.notEqual(backed, null)
  assert.equal(backed?.current, 'search')
  assert.deepEqual(backed?.back, ['home'])
  assert.deepEqual(backed?.forward, ['playlistDetail'])
  const forwarded = goForward(backed ?? h)
  assert.equal(forwarded?.current, 'playlistDetail')
  assert.deepEqual(forwarded?.forward, [])
})

test('后退后发起新导航：前进栈被清空（浏览器语义）', () => {
  let h = emptyHistory('home')
  h = navigateTo(h, 'search', eq)
  const backed = goBack(h) ?? h
  h = navigateTo(backed, 'library', eq)
  assert.equal(h.current, 'library')
  assert.deepEqual(h.forward, [])
  assert.equal(canGoForward(h), false)
})

test('目标与 current 相同不入栈（重复点同一导航项）', () => {
  let h = emptyHistory('home')
  h = navigateTo(h, 'home', eq)
  assert.deepEqual(h.back, [])
  assert.equal(canGoBack(h), false)
})

test('空栈后退/前进返回 null（调用方保持原状）', () => {
  const h = emptyHistory('home')
  assert.equal(goBack(h), null)
  assert.equal(goForward(h), null)
})

test('多次后退到起点后 forward 链完整', () => {
  let h = emptyHistory('a')
  h = navigateTo(h, 'b', eq)
  h = navigateTo(h, 'c', eq)
  h = goBack(h) ?? h
  h = goBack(h) ?? h
  assert.equal(h.current, 'a')
  assert.equal(canGoBack(h), false)
  assert.deepEqual(h.forward, ['b', 'c'])
})

test('replaceCurrent 替换 current 不动历史链（专注模式进出用）', () => {
  let h = emptyHistory('home')
  h = navigateTo(h, 'search', eq)
  const focused = replaceCurrent(h, 'focus')
  assert.equal(focused.current, 'focus')
  assert.deepEqual(focused.back, ['home'])
  const restored = replaceCurrent(focused, 'search')
  assert.equal(restored.current, 'search')
  assert.deepEqual(restored.back, ['home'])
  assert.deepEqual(restored.forward, [])
})
