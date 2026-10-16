// 分类页 Tab 记忆（src/state/categoryTab.ts）回归锚点。
//
// 这份记忆替代了 CategoryView 组件文件里的模块级 Map：进出专注模式时组件卸载重建，
// 靠它把「离开前是哪个 Tab」按分类 key 带回来。这里锁定读写往返、分类隔离、
// 未知 key 语义与内存有界（key 只来自 genres.ts 的有限分类集合）。

import assert from 'node:assert/strict'
import test from 'node:test'
import { GENRES } from '../src/state/genres'
import {
  categoryTabMemorySize,
  readCategoryTab,
  rememberCategoryTab,
} from '../src/state/categoryTab'

test('读写往返：remember 之后 read 得到同一个 Tab', () => {
  rememberCategoryTab('pop', 'songs')
  assert.equal(readCategoryTab('pop'), 'songs')
  rememberCategoryTab('pop', 'playlists')
  assert.equal(readCategoryTab('pop'), 'playlists')
})

test('不同分类互不串台', () => {
  rememberCategoryTab('rock', 'songs')
  rememberCategoryTab('jazz', 'playlists')
  assert.equal(readCategoryTab('rock'), 'songs')
  assert.equal(readCategoryTab('jazz'), 'playlists')
})

test('未知 key（从未写过）返回 undefined，而不是抛错或默认值', () => {
  assert.equal(readCategoryTab('not-a-real-genre'), undefined)
})

test('内存有界：genres.ts 全部分类 key 各写一次后条目数等于分类数量', () => {
  for (const genre of GENRES) {
    rememberCategoryTab(genre.key, 'songs')
  }
  // 前面几个用例只写过 GENRES 内的 key，所以上界就是分类数量（不硬编码数字）
  assert.equal(categoryTabMemorySize(), GENRES.length)
})
