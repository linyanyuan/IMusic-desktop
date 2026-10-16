// 最近搜索纯逻辑模块（src/state/recentSearches.ts）—— 两条用户反馈的回归锁定：
//   1. 最近搜索只能整块清空，不能删单条；
//   2. 搜索框里输入空内容回车，历史里会多出一条空条目。
//
// 这里给模块注入内存假存储直接测纯函数，不依赖 electron / DOM / 真实 localStorage。

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearRecentSearches,
  loadRecentSearches,
  pushRecentSearch,
  removeRecentSearch,
  RECENT_SEARCHES_KEY,
  RECENT_SEARCHES_MAX,
  type RecentSearchStorage,
} from '../src/state/recentSearches'

function memStorage(initial?: string): RecentSearchStorage & { dump: () => string | null } {
  const map = new Map<string, string>()
  if (initial != null) map.set(RECENT_SEARCHES_KEY, initial)
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
    dump: () => map.get(RECENT_SEARCHES_KEY) ?? null,
  }
}

test('空/纯空白查询不入列表，也不写入存储', () => {
  const s = memStorage()
  assert.deepEqual(pushRecentSearch('', s), [])
  assert.deepEqual(pushRecentSearch('   ', s), [])
  assert.deepEqual(pushRecentSearch('\t\n', s), [])
  assert.deepEqual(loadRecentSearches(s), [])
  assert.equal(s.dump(), null)
})

test('push 先 trim 再存储', () => {
  const s = memStorage()
  assert.deepEqual(pushRecentSearch('  周杰伦  ', s), ['周杰伦'])
  assert.deepEqual(loadRecentSearches(s), ['周杰伦'])
})

test('重复关键词去重并置顶', () => {
  const s = memStorage()
  pushRecentSearch('a', s)
  pushRecentSearch('b', s)
  assert.deepEqual(pushRecentSearch('a', s), ['a', 'b'])
  assert.deepEqual(loadRecentSearches(s), ['a', 'b'])
})

test('最多保留 8 条，顺序为新→旧', () => {
  const s = memStorage()
  for (let i = 1; i <= 10; i += 1) pushRecentSearch(`q${i}`, s)
  const list = loadRecentSearches(s)
  assert.equal(list.length, RECENT_SEARCHES_MAX)
  assert.deepEqual(list, ['q10', 'q9', 'q8', 'q7', 'q6', 'q5', 'q4', 'q3'])
})

test('删除单条：命中则移除，未命中列表不变', () => {
  const s = memStorage()
  pushRecentSearch('a', s)
  pushRecentSearch('b', s)
  pushRecentSearch('c', s)
  assert.deepEqual(removeRecentSearch('b', s), ['c', 'a'])
  assert.deepEqual(loadRecentSearches(s), ['c', 'a'])
  assert.deepEqual(removeRecentSearch('zzz', s), ['c', 'a'])
  // 传进来的词同样先 trim 再匹配
  assert.deepEqual(removeRecentSearch('  c  ', s), ['a'])
})

test('清空：删除整个 key 并返回空列表', () => {
  const s = memStorage()
  pushRecentSearch('a', s)
  assert.deepEqual(clearRecentSearches(s), [])
  assert.equal(s.dump(), null)
  assert.deepEqual(loadRecentSearches(s), [])
})

test('坏数据自愈：非 JSON / 非数组 / 非字符串元素 / 空白元素', () => {
  assert.deepEqual(loadRecentSearches(memStorage('not json')), [])
  assert.deepEqual(loadRecentSearches(memStorage('{"a":1}')), [])
  assert.deepEqual(loadRecentSearches(memStorage('"just a string"')), [])
  assert.deepEqual(loadRecentSearches(memStorage('["ok","",null,42,"  ","two"]')), [
    'ok',
    'two',
  ])
})

test('storage 为 null / 省略时不抛异常', () => {
  assert.deepEqual(loadRecentSearches(null), [])
  assert.deepEqual(pushRecentSearch('x', null), ['x'])
  assert.deepEqual(removeRecentSearch('x', null), [])
  assert.deepEqual(clearRecentSearches(null), [])
  // 省略 storage → 用 globalThis.localStorage；Node 下不存在时当作空存储
  assert.deepEqual(loadRecentSearches(), [])
  assert.deepEqual(pushRecentSearch('y'), ['y'])
})

test('返回值总是新数组，不改动已有列表', () => {
  const s = memStorage()
  pushRecentSearch('a', s)
  const first = loadRecentSearches(s)
  const second = loadRecentSearches(s)
  assert.notEqual(first, second)
  assert.deepEqual(first, second)

  const pushed = pushRecentSearch('b', s)
  assert.notEqual(pushed, first)
  // 之前拿到的列表不受后续写入影响
  assert.deepEqual(first, ['a'])
  assert.deepEqual(pushed, ['b', 'a'])
})
