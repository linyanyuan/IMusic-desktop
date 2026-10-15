// 「今日精选」日期种子 —— 回归锚点。
//
// 精选的定义：以日期为种子的主题精选歌单，当天固定、次日换主题。
// 不能退回 recommended.slice(0, 2)（那是推荐 feed 的前两条，没有独立含义）。

import assert from 'node:assert/strict'
import test from 'node:test'
import { dailyFeatured } from '../src/state/featured'
import { hotPlaylistQueryForBatch } from '../src/services/bilibili'

const DAY = 86_400_000

test('同一天内任意时刻种子相同（反复进首页精选不变）', () => {
  const morning = dailyFeatured(Date.UTC(2026, 9, 15, 1, 0, 0))
  const evening = dailyFeatured(Date.UTC(2026, 9, 15, 13, 30, 0))
  assert.deepEqual(morning, evening)
})

test('跨天换主题，且与热门歌单主题池一致', () => {
  const day1 = dailyFeatured(Date.UTC(2026, 9, 15))
  const day2 = dailyFeatured(Date.UTC(2026, 9, 16))
  assert.notEqual(day1.batch, day2.batch)
  // theme 必须就是热门歌单批次对应的关键词（同一主题池，不会出现「精选主题」与网格对不上的情况）
  assert.equal(day1.theme, hotPlaylistQueryForBatch(day1.batch).keyword)
  assert.equal(day2.theme, hotPlaylistQueryForBatch(day2.batch).keyword)
})

test('连续 10 天主题各不相同（一轮 10 个主题）', () => {
  const themes = new Set<string>()
  for (let i = 0; i < 10; i++) {
    themes.add(dailyFeatured(Date.UTC(2026, 9, 15) + i * DAY).theme)
  }
  assert.equal(themes.size, 10)
})

test('batch 永不为负（纪元前/边界时间也安全）', () => {
  for (const t of [0, -DAY * 3, Date.UTC(1970, 0, 1), Date.UTC(2100, 0, 1)]) {
    const { batch } = dailyFeatured(t)
    assert.ok(batch >= 0 && batch < 10, `t=${t} 时 batch=${batch} 应落在 [0,10)`)
  }
})
