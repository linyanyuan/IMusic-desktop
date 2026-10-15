// 热门歌单「换一批」关键词轮换 —— 回归锚点。
//
// 用户反馈：热门歌单与推荐歌曲「几乎一样」。换一批必须给出真正不同的内容 ——
// 同一关键词连翻几页观感雷同，所以按批次轮换搜索主题，主题内部再翻页。

import assert from 'node:assert/strict'
import test from 'node:test'
import { hotPlaylistQueryForBatch } from '../src/services/bilibili'

test('前 10 批每批关键词都不同', () => {
  const keywords = new Set<string>()
  for (let batch = 0; batch < 10; batch++) {
    const { keyword, page } = hotPlaylistQueryForBatch(batch)
    assert.equal(page, 1, `批次 ${batch} 应该在主题的第 1 页`)
    keywords.add(keyword)
  }
  assert.equal(keywords.size, 10, '10 批应轮换 10 个不同主题，否则换一批观感雷同')
})

test('一轮用完后回到首主题并翻到第 2 页', () => {
  const first = hotPlaylistQueryForBatch(0)
  const wrapped = hotPlaylistQueryForBatch(10)
  assert.equal(wrapped.keyword, first.keyword)
  assert.equal(wrapped.page, 2)
  assert.equal(hotPlaylistQueryForBatch(21).page, 3)
})

test('非法批次按批次 0 处理', () => {
  assert.deepEqual(hotPlaylistQueryForBatch(-1), hotPlaylistQueryForBatch(0))
  assert.deepEqual(hotPlaylistQueryForBatch(2.9), hotPlaylistQueryForBatch(2))
})
