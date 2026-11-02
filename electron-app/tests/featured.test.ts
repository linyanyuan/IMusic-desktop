// 「今日精选」日期种子 → 真实网易云分类 —— 回归锚点。
//
// 精选的定义：以 UTC 日期为种子，从真实网易云分类池里挑一个分类，
// 首页再取该分类按热度排序的歌单做轮播大卡。当天固定、次日换分类；
// 主题名与请求分类必须一致（不能再出现「标题粤语、内容韩语」的错位），
// 也不能退回 recommended.slice(0, 2)（那是推荐 feed 的前两条，没有独立含义）。

import assert from 'node:assert/strict'
import test from 'node:test'
import { dailyFeatured, FEATURED_CATEGORIES } from '../src/state/featured'
import { GENRES } from '../src/state/genres'
import { selectHotPlaylists } from '../src/state/hotRotation'

const DAY = 86_400_000

/** 今日精选实际上屏的筛法：HomeView 拿 getCategoryPlaylists 的结果直接过 selectHotPlaylists */
const FEATURED_COUNT = 8

test('同一天内任意时刻种子相同（反复进首页精选不变）', () => {
  const morning = dailyFeatured(Date.UTC(2026, 9, 15, 1, 0, 0))
  const evening = dailyFeatured(Date.UTC(2026, 9, 15, 13, 30, 0))
  assert.deepEqual(morning, evening)
})

test('跨天换分类，且主题名就是来源分类（标题与内容必然一致）', () => {
  const day1 = dailyFeatured(Date.UTC(2026, 9, 15))
  const day2 = dailyFeatured(Date.UTC(2026, 9, 16))
  assert.notEqual(day1.category, day2.category)
  assert.equal(day1.theme, `${day1.category}精选`)
  assert.equal(day2.theme, `${day2.category}精选`)
})

test('连续 N 天恰好轮完整个分类池（每天不重样），第 N+1 天回到池首', () => {
  const seen = new Set<string>()
  const start = Date.UTC(2026, 9, 15)
  for (let i = 0; i < FEATURED_CATEGORIES.length; i++) {
    seen.add(dailyFeatured(start + i * DAY).category)
  }
  assert.equal(seen.size, FEATURED_CATEGORIES.length)
  assert.equal(
    dailyFeatured(start + FEATURED_CATEGORIES.length * DAY).category,
    dailyFeatured(start).category,
  )
})

test('分类池每一项都是真实存在的网易云分类（与 genres.ts 的 neteaseCat 对齐）', () => {
  // genres.ts 头部约定：neteaseCat 必须是网易云 /api/playlist/catalogue 里真实存在的
  // 分类名（2026-10 实测 70 个）。精选池 ⊆ 该集合，接口才不会拿到空列表。
  const realCats = new Set(GENRES.map((genre) => genre.neteaseCat))
  for (const cat of FEATURED_CATEGORIES) {
    assert.ok(realCats.has(cat), `精选分类「${cat}」不在已知真实网易云分类集合里`)
  }
})

test('分类池无重复、无空串', () => {
  assert.equal(new Set(FEATURED_CATEGORIES).size, FEATURED_CATEGORIES.length)
  for (const cat of FEATURED_CATEGORIES) {
    assert.ok(cat.trim() !== '', '精选分类不允许空串')
  }
})

test('category 就是池内第 index 项（请求参数与下标自洽）', () => {
  for (const t of [0, Date.UTC(2026, 9, 15), Date.UTC(2100, 0, 1)]) {
    const daily = dailyFeatured(t)
    assert.equal(daily.category, FEATURED_CATEGORIES[daily.index])
  }
})

test('index 永不为负（纪元前/边界时间也安全）', () => {
  for (const t of [0, -DAY * 3, Date.UTC(1970, 0, 1), Date.UTC(2100, 0, 1)]) {
    const { index } = dailyFeatured(t)
    assert.ok(
      index >= 0 && index < FEATURED_CATEGORIES.length,
      `t=${t} 时 index=${index} 应落在 [0,${FEATURED_CATEGORIES.length})`,
    )
  }
})

// ── 上屏前的筛选（HomeView 今日精选的契约）───────────────────────────────
// 轮播以 `key={playlist.id}` 渲染卡位、每张卡都能点进详情。直接 slice 上游列表意味着：
// - 同一 id 出现两次 → 两个卡位并成一个（React key 重复），滑动窗长度与位置也算错；
// - 空 id / 空载荷 id（`bilibili:`）→ 卡能点，点进去必然掉到无效详情页。
// 所以 HomeView 必须复用热门歌单的筛选口径 selectHotPlaylists。

test('精选列表上屏前：丢重复 id、空 id 与显式非歌单', () => {
  const raw = [
    { id: 'netease:1', title: 'A', resultType: 'playlist' },
    { id: 'netease:1', title: 'A（上游重复）', resultType: 'playlist' },
    { id: 'netease:2', title: 'B', resultType: 'playlist' },
    { id: 'bilibili:', title: '空载荷 id', resultType: 'playlist' },
    { id: '   ', title: '空白 id', resultType: 'playlist' },
    { id: 'netease:3', title: 'C', resultType: 'song' },
    { id: 'netease:4', title: 'D' },
  ]
  const picked = selectHotPlaylists(raw, { limit: FEATURED_COUNT })
  assert.deepEqual(
    picked.map((row) => row.id),
    ['netease:1', 'netease:2', 'netease:4'],
    '只剩可用且唯一的歌单（第一个 netease:1 胜出，标题保留原样）',
  )
  assert.equal(picked[0].title, 'A')
})

test('精选列表上屏前：最多 FEATURED_COUNT 个，且按上游顺序取前几个', () => {
  const raw = Array.from({ length: 12 }, (_, i) => ({
    id: `netease:${i}`,
    title: `歌单 ${i}`,
    resultType: 'playlist',
  }))
  const picked = selectHotPlaylists(raw, { limit: FEATURED_COUNT })
  assert.equal(picked.length, FEATURED_COUNT)
  assert.deepEqual(
    picked.map((row) => row.id),
    raw.slice(0, FEATURED_COUNT).map((row) => row.id),
  )
})

test('精选列表上屏前：全是垃圾输入时得到空列表（页面自然落到不渲染轮播）', () => {
  assert.deepEqual(selectHotPlaylists([], { limit: FEATURED_COUNT }), [])
  assert.deepEqual(
    selectHotPlaylists(
      [
        { id: '', resultType: 'playlist' },
        { id: 'netease:', resultType: 'playlist' },
        { id: 'netease:9', resultType: 'song' },
      ],
      { limit: FEATURED_COUNT },
    ),
    [],
  )
})
