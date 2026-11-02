// 首页「热门歌单」轮换窗口 —— 回归锚点。
//
// 用户反馈：「首页热门歌单每次进去都一样」。
//
// 根因（2026-10 对 music.163.com 公开接口的实测）：
//   旧实现固定请求 `getHotPlaylists` 的第 N 批（offset 单调 +10），而「全部」的
//   order=hot 在服务端是**完全稳定**的（同一 URL 连请求 4 次 id 序列一模一样，
//   加 cache-buster / no-cache 也不变），NeteasePublicClient 还有 30 分钟缓存 ——
//   于是首屏永远同一批。
//   真正的变化源是按分类（华语/粤语/民谣…）的 order=hot：每次请求随机取样
//   （同一 offset 连请求两次 10 条重叠 0–1），深度也够。
//
// 因此：变化来自「换分类 + 真翻页」的确定性游标，不是把同一批 10 个本地重排。
// 移植自 my-music-new packages/core/tests/hot-rotation.test.ts，并新增桌面端的
// sourceCategories（补窗跨分类如实标注）与 boundShownIds（有界历史）锚点。

import assert from 'node:assert/strict'
import test from 'node:test'
import { FEATURED_CATEGORIES } from '../src/state/featured'
import {
  DEFAULT_HOT_LIMIT,
  HOT_CATEGORIES,
  HOT_CURSOR_STORAGE_KEY,
  HOT_MAX_WINDOWS_PER_LOAD,
  HOT_PAGE_ROUNDS,
  HOT_WINDOW_COUNT,
  advanceHotCursor,
  boundShownIds,
  dailyHotCursor,
  fillHotPlaylists,
  hotPlaylistKey,
  isUsableHotPlaylist,
  hotWindowCandidates,
  hotWindowFor,
  nextHotCursor,
  normalizeHotCursor,
  peekHotCursor,
  selectHotPlaylists,
} from '../src/state/hotRotation'
import type { HotWindow } from '../src/state/hotRotation'
import { MemoryStorage } from '../src/services/storage'

const DAY = 86_400_000

function playlist(id: string, extra: Record<string, unknown> = {}) {
  return { id, title: `歌单 ${id}`, resultType: 'playlist', ...extra }
}

// ---- 游标 ----

test('分类池第一项是「全部」，其余复用今日精选池（保证分类名真实存在）', () => {
  assert.equal(HOT_CATEGORIES[0], '全部')
  assert.deepEqual([...HOT_CATEGORIES.slice(1)], [...FEATURED_CATEGORIES])
  assert.equal(HOT_WINDOW_COUNT, HOT_CATEGORIES.length * HOT_PAGE_ROUNDS)
})

test('游标归一化：负数 / 小数 / NaN / Infinity 都落在窗口范围内', () => {
  for (const raw of [-1, -HOT_WINDOW_COUNT * 3, 0, 3.9, HOT_WINDOW_COUNT, Number.NaN, Infinity, -Infinity]) {
    const cursor = normalizeHotCursor(raw)
    assert.ok(
      Number.isInteger(cursor) && cursor >= 0 && cursor < HOT_WINDOW_COUNT,
      `normalizeHotCursor(${raw}) = ${cursor} 应落在 [0,${HOT_WINDOW_COUNT})`,
    )
  }
  assert.equal(normalizeHotCursor(-1), HOT_WINDOW_COUNT - 1)
  assert.equal(normalizeHotCursor(3.9), 3)
  assert.equal(normalizeHotCursor(Number.NaN), 0)
})

test('末尾回绕到 0（游标永不越界、也不会停在原地）', () => {
  assert.equal(nextHotCursor(HOT_WINDOW_COUNT - 1), 0)
  assert.equal(nextHotCursor(0), 1)
  assert.equal(nextHotCursor(-1), 0)
})

test('一轮窗口内不重复：HOT_WINDOW_COUNT 个游标是 HOT_WINDOW_COUNT 个不同请求', () => {
  const seen = new Set<string>()
  for (let cursor = 0; cursor < HOT_WINDOW_COUNT; cursor++) {
    const win = hotWindowFor(cursor)
    seen.add(`${win.category}#${win.offset}`)
  }
  assert.equal(seen.size, HOT_WINDOW_COUNT, '同一轮里不能有两个游标请求同一个分类同一页')
})

test('游标推进先换分类（观感差别大），一轮吃完才回到同分类更深页', () => {
  const first = hotWindowFor(0)
  const second = hotWindowFor(1)
  assert.equal(first.category, '全部')
  assert.equal(first.round, 0)
  assert.equal(first.offset, 0)
  assert.equal(second.category, HOT_CATEGORIES[1], '第二个窗口应换到下一个分类')
  assert.notEqual(second.category, first.category)
  assert.equal(second.offset, 0, '还没吃完一轮分类，不该先往深处翻')

  const wrapped = hotWindowFor(HOT_CATEGORIES.length)
  assert.equal(wrapped.category, first.category, '吃完一轮分类回到第一个分类')
  assert.equal(wrapped.round, 1)
  assert.equal(wrapped.offset, DEFAULT_HOT_LIMIT, '回到同一分类时要翻到更深页，而不是同一批')
})

test('窗口的 offset 跟随 limit 走（换 limit 不会撞同一批）', () => {
  const small = hotWindowFor(HOT_CATEGORIES.length, 5)
  const big = hotWindowFor(HOT_CATEGORIES.length, 20)
  assert.equal(small.offset, 5)
  assert.equal(big.offset, 20)
  assert.equal(hotWindowFor(0, 0).limit, DEFAULT_HOT_LIMIT, '非法 limit 回落默认值')
  assert.equal(hotWindowFor(0, -3).limit, DEFAULT_HOT_LIMIT)
})

test('候选窗口从起始游标连号展开（补源时不会重复请求同一窗口）', () => {
  const windows = hotWindowCandidates(3, 10, 3)
  assert.deepEqual(
    windows.map((w) => w.cursor),
    [3, 4, 5],
  )
  assert.deepEqual(hotWindowCandidates(HOT_WINDOW_COUNT - 1, 10, 3).map((w) => w.cursor), [
    HOT_WINDOW_COUNT - 1,
    0,
    1,
  ])
})

// ---- 持久化游标 ----

test('冷启动读历史游标并前进一格，写回新值', () => {
  const storage = new MemoryStorage()
  storage.setString(HOT_CURSOR_STORAGE_KEY, '4')

  assert.equal(advanceHotCursor(storage), 5)
  assert.equal(peekHotCursor(storage), 5, '新游标必须落盘，否则下次启动又从 4 开始')
  assert.equal(advanceHotCursor(storage), 6, '连续两次冷启动应连续前进')
})

test('首次安装（无历史值）退化成按天游标，并记下来供下次前进', () => {
  const storage = new MemoryStorage()
  const now = Date.UTC(2026, 9, 15, 8, 0, 0)
  const expected = dailyHotCursor(now)

  assert.equal(advanceHotCursor(storage, now), expected)
  assert.equal(peekHotCursor(storage), expected)
  assert.equal(
    advanceHotCursor(storage, now),
    nextHotCursor(expected),
    '第二次就应当从按天游标继续前进',
  )
})

test('按天游标：同一天不变、隔天变化（存储完全不可用时的底线）', () => {
  const morning = dailyHotCursor(Date.UTC(2026, 9, 15, 1, 0, 0))
  const evening = dailyHotCursor(Date.UTC(2026, 9, 15, 23, 0, 0))
  assert.equal(morning, evening)
  assert.notEqual(morning, dailyHotCursor(Date.UTC(2026, 9, 15) + DAY))

  // storage = null 时必须安全退化，而不是抛错
  assert.equal(advanceHotCursor(null, Date.UTC(2026, 9, 15)), morning)
})

test('持久化值损坏时当成没存过（不抛错、不返回 NaN）', () => {
  const storage = new MemoryStorage()
  for (const bad of ['', '  ', 'abc', 'NaN', '3.5']) {
    storage.setString(HOT_CURSOR_STORAGE_KEY, bad)
    const cursor = advanceHotCursor(storage, Date.UTC(2026, 9, 15))
    assert.ok(
      Number.isInteger(cursor) && cursor >= 0 && cursor < HOT_WINDOW_COUNT,
      `损坏值 "${bad}" 应回落到合法游标，实际 ${cursor}`,
    )
  }
})

test('游标写满一整轮也不会越界（读到的是归一化值）', () => {
  const storage = new MemoryStorage()
  storage.setString(HOT_CURSOR_STORAGE_KEY, String(HOT_WINDOW_COUNT * 5 + 2))
  assert.equal(advanceHotCursor(storage), 3)
  assert.equal(peekHotCursor(storage), 3)
})

// ---- 选择与去重 ----

test('空 id 与显式非歌单条目被丢掉（点进去必然失败的不能摆出来）', () => {
  const picked = selectHotPlaylists([
    playlist('netease-playlist:1'),
    { id: '', title: '空载荷', resultType: 'playlist' },
    { id: '   ', title: '空白 id', resultType: 'playlist' },
    { id: 'netease-playlist:2', title: '一首歌', resultType: 'song' },
    { id: 'netease-playlist:3', title: '没写 resultType' },
  ])
  assert.deepEqual(
    picked.map((item) => item.id),
    ['netease-playlist:1', 'netease-playlist:3'],
  )
})

test('同一批内 id 重复只保留第一个（上游一页里会重复）', () => {
  const picked = selectHotPlaylists([
    playlist('a'),
    playlist('a', { title: '同名同 id 的第二次出现' }),
    playlist('b'),
  ])
  assert.deepEqual(
    picked.map((item) => item.title),
    ['歌单 a', '歌单 b'],
  )
})

test('excludeIds 过滤掉上一批已经展示过的歌单（换一批不重摆旧内容）', () => {
  const batch1 = selectHotPlaylists([playlist('a'), playlist('b'), playlist('c')])
  const batch2 = selectHotPlaylists(
    [playlist('a'), playlist('b'), playlist('c'), playlist('d')],
    { excludeIds: batch1.map((item) => item.id) },
  )
  assert.deepEqual(
    batch2.map((item) => item.id),
    ['d'],
    '命中去重的宁可少几个，也不能把上一批再摆一遍',
  )
})

test('excludeIds 里的空串/空白不会误伤（不能把所有条目都排掉）', () => {
  const picked = selectHotPlaylists([playlist('a'), playlist('b')], {
    excludeIds: ['', '   '],
  })
  assert.equal(picked.length, 2)
})

test('同名不同 id 是两张不同歌单，不能被标题去重吞掉', () => {
  const picked = selectHotPlaylists([
    playlist('1', { title: '2024 华语热歌' }),
    playlist('2', { title: '2024 华语热歌' }),
  ])
  assert.equal(picked.length, 2)
  assert.notEqual(hotPlaylistKey(picked[0]), hotPlaylistKey(picked[1]))
})

test('limit 生效，且非法 limit 回落默认值', () => {
  const many = Array.from({ length: 30 }, (_, i) => playlist(String(i)))
  assert.equal(selectHotPlaylists(many, { limit: 4 }).length, 4)
  assert.equal(selectHotPlaylists(many).length, DEFAULT_HOT_LIMIT)
  assert.equal(selectHotPlaylists(many, { limit: 0 }).length, DEFAULT_HOT_LIMIT)
  assert.equal(selectHotPlaylists(many, { limit: Number.NaN }).length, DEFAULT_HOT_LIMIT)
})

test('同一批过滤口径可用性判定：isUsableHotPlaylist 与 selectHotPlaylists 一致', () => {
  assert.equal(isUsableHotPlaylist(null), false)
  assert.equal(isUsableHotPlaylist(undefined), false)
  assert.equal(isUsableHotPlaylist({ id: '' }), false)
  assert.equal(isUsableHotPlaylist({ id: 'bilibili:' }), false, '空载荷 id 不可用')
  assert.equal(isUsableHotPlaylist({ id: 'a', resultType: 'song' }), false, '不是歌单')
  assert.equal(isUsableHotPlaylist({ id: 'a' }), true, '没写 resultType 当歌单处理')
  assert.equal(isUsableHotPlaylist(playlist('a')), true)
})

test('连续两批完整轮换：第 2 批与第 1 批零重叠，且不会只剩空', () => {
  // 模拟上游：每个窗口返回同一批热门歌单（最坏情况，服务端完全稳定）
  const samePool = Array.from({ length: 10 }, (_, i) => playlist(`hot-${i}`))
  const batch1 = selectHotPlaylists(samePool, { limit: 10 })
  const batch2 = selectHotPlaylists(
    samePool.map((item) => ({ ...item })), // 新对象、同 id —— 模拟「又拿到同一批」
    { limit: 10, excludeIds: batch1.map((item) => item.id) },
  )
  assert.equal(batch1.length, 10)
  assert.equal(batch2.length, 0, '上游完全稳定时第 2 批必然为空 —— 这正是需要补源/明示的信号')
})

// ---- 跨批去重历史的有界合并（桌面端新增：移动端只靠 exhausted 时收缩） ----

test('boundShownIds：不超上限时按序合并、去重、丢空 id', () => {
  const result = boundShownIds(['a', 'b', 'a', '  '], ['b', 'c'], 10)
  assert.deepEqual(result, ['a', 'b', 'c'], '先去重（保序），当前屏 id 已在历史中时不重复收录')
})

test('boundShownIds：超上限从最旧的开始丢，当前屏一个都不能少', () => {
  const previous = Array.from({ length: 8 }, (_, i) => `old-${i}`)
  const current = ['new-0', 'new-1']
  const result = boundShownIds(previous, current, 6)
  assert.deepEqual(
    result,
    ['old-4', 'old-5', 'old-6', 'old-7', 'new-0', 'new-1'],
    '只丢最旧的 4 个',
  )
  assert.ok(current.every((id) => result.includes(id)), '当前屏 id 绝不能被挤掉')
})

test('boundShownIds：当前屏 id 出现在历史最前面也受保护（丢的是后面的旧 id）', () => {
  // merged = [a,b,c,d,e]（'a' 去重后保留在首位），cap=4 要丢 1 个；
  // 'a' 是当前屏不能丢 → 丢 'b'
  const result = boundShownIds(['a', 'b', 'c', 'd'], ['a', 'e'], 4)
  assert.deepEqual(result, ['a', 'c', 'd', 'e'])
})

test('boundShownIds：默认上限 = 一整轮窗口 × 每批条数', () => {
  const previous = Array.from(
    { length: HOT_WINDOW_COUNT * DEFAULT_HOT_LIMIT + 50 },
    (_, i) => `old-${i}`,
  )
  const current = ['cur-0', 'cur-1']
  const result = boundShownIds(previous, current)
  assert.equal(result.length, HOT_WINDOW_COUNT * DEFAULT_HOT_LIMIT)
  assert.ok(result.includes('cur-0') && result.includes('cur-1'), '当前屏必须保留')
  assert.ok(!result.includes('old-0') && !result.includes('old-49'), '最旧的应被挤掉')
})

test('boundShownIds：病态输入（当前屏比 cap 还大）宁可超 cap 也不丢当前屏', () => {
  const current = Array.from({ length: 5 }, (_, i) => `cur-${i}`)
  const result = boundShownIds(['x', 'y'], current, 3)
  assert.ok(current.every((id) => result.includes(id)), '「不丢当前屏」优先于「不超 cap」')
})

test('boundShownIds：非法 cap 回落默认上限', () => {
  const previous = Array.from({ length: 5 }, (_, i) => `old-${i}`)
  const result = boundShownIds(previous, ['cur'], Number.NaN)
  assert.equal(result.length, 6, 'NaN cap 不应截断（回落到默认大上限）')
})

// ---- 一次「取一批」到底问几个窗口 ----

/** 造一个假的上游：按 `${category}#${offset}` 返回预设数据 */
function fakeUpstream(pages: Record<string, Array<ReturnType<typeof playlist>>>) {
  const asked: string[] = []
  return {
    asked,
    fetchWindow: (win: HotWindow) => {
      const key = `${win.category}#${win.offset}`
      asked.push(key)
      const rows = pages[key]
      if (rows == null) throw new Error(`上游没有 ${key}`)
      return Promise.resolve(rows)
    },
  }
}

test('主窗口就够时只发 1 个请求（不能让换一批变成连发一串）', async () => {
  const pool = Array.from({ length: 10 }, (_, i) => playlist(`a-${i}`))
  const upstream = fakeUpstream({ '全部#0': pool })

  const result = await fillHotPlaylists({ startCursor: 0, fetchWindow: upstream.fetchWindow })

  assert.equal(result.items.length, 10)
  assert.equal(upstream.asked.length, 1)
  assert.equal(result.windows.length, 1)
  assert.equal(result.okWindows, 1)
  assert.equal(result.exhausted, false)
  assert.deepEqual(result.sourceCategories, ['全部'], '单窗口供源时贡献分类就是该窗口分类')
})

test('主窗口重样时继续问下一个窗口，直到凑够或问完上限', async () => {
  const shown = Array.from({ length: 10 }, (_, i) => playlist(`老-${i}`))
  const secondKey = `${HOT_CATEGORIES[1]}#0`
  const thirdKey = `${HOT_CATEGORIES[2]}#0`
  const upstream = fakeUpstream({
    '全部#0': shown.map((item) => ({ ...item })), // 已经展示过的同一批
    [secondKey]: Array.from({ length: 4 }, (_, i) => playlist(`新-${i}`)),
    [thirdKey]: Array.from({ length: 10 }, (_, i) => playlist(`再新-${i}`)),
  })

  const result = await fillHotPlaylists({
    startCursor: 0,
    excludeIds: shown.map((item) => item.id),
    fetchWindow: upstream.fetchWindow,
  })

  assert.deepEqual(upstream.asked, ['全部#0', secondKey, thirdKey])
  assert.equal(result.windows.length, 3)
  assert.equal(result.okWindows, 3)
  assert.equal(result.items.length, 10, '补源要凑满 10 个')
  // 缺口来自第二个窗口（4 个），其余由第三个窗口补齐
  assert.equal(result.items.filter((item) => item.id.startsWith('新-')).length, 4)
  assert.equal(result.items.filter((item) => item.id.startsWith('再新-')).length, 6)
  assert.equal(result.exhausted, false)
  // 主窗口整窗是旧面孔、一条都没用上 → 来源必须指向第二个窗口，
  // 否则首页会把第二分类的内容标成「全部」。
  assert.equal(
    result.sourceWindow?.cursor,
    1,
    '来源窗口必须是真的贡献了内容的那个，而不是起始窗口',
  )
  assert.deepEqual(
    result.sourceCategories,
    [HOT_CATEGORIES[1], HOT_CATEGORIES[2]],
    '补窗跨分类时两个分类都贡献了内容，必须都记下来（只写第一个就是误标）',
  )
})

test('sourceWindow：主窗口请求失败时指向成功供源的窗口', async () => {
  const fake = fakeUpstream({
    [`${HOT_CATEGORIES[1]}#0`]: Array.from({ length: 10 }, (_, i) => playlist(`ok-${i}`)),
  })
  const asked: string[] = []
  const result = await fillHotPlaylists({
    startCursor: 0,
    fetchWindow: async (window) => {
      asked.push(window.category)
      if (window.cursor === 0) throw new Error('boom')
      return fake.fetchWindow(window)
    },
  })

  assert.deepEqual(asked, ['全部', HOT_CATEGORIES[1]])
  assert.equal(result.okWindows, 1)
  assert.equal(result.items.length, 10)
  assert.equal(
    result.sourceWindow?.category,
    HOT_CATEGORIES[1],
    // 第一个窗口挂了、内容全来自第二个：来源必须写第二个分类，
    // 否则用户看到的「网易云 · 全部」里装的全是别分类的内容
    '来源必须指向真正供源的分类，而不是起始窗口',
  )
  assert.deepEqual(result.sourceCategories, [HOT_CATEGORIES[1]], '失败的窗口不算贡献分类')
})

test('sourceWindow / sourceCategories：一个都没选中时分别为 null / []', async () => {
  const shown = Array.from({ length: 10 }, (_, i) => playlist(`老-${i}`))
  const same = shown.map((item) => ({ ...item }))
  const result = await fillHotPlaylists({
    startCursor: 0,
    excludeIds: shown.map((item) => item.id),
    fetchWindow: async () => same.map((item) => ({ ...item })),
  })

  assert.equal(result.items.length, 0)
  assert.equal(result.exhausted, true)
  assert.equal(result.candidateCount, 10, '三个窗口都真的给过 10 个可用候选（只是全是旧面孔）')
  assert.equal(result.emptyWindows, 0, '空窗口会阻止 exhausted 判定')
  assert.equal(result.sourceWindow, null, '没有内容就没有来源，不能凭空指一个窗口')
  assert.deepEqual(result.sourceCategories, [], '没有内容就没有贡献分类')
})

test('sourceWindow：有内容时不为 null，且落在实际请求过的窗口里', async () => {
  const upstream = fakeUpstream({
    '全部#0': Array.from({ length: 10 }, (_, i) => playlist(`a-${i}`)),
  })
  const result = await fillHotPlaylists({ startCursor: 0, fetchWindow: upstream.fetchWindow })
  assert.equal(result.items.length, 10)
  assert.notEqual(result.sourceWindow, null)
  assert.equal(result.sourceWindow?.cursor, 0)
  assert.ok(
    result.windows.some((window) => window.cursor === result.sourceWindow?.cursor),
    '来源窗口必须是这次真的问过的窗口之一',
  )
})

test('窗口请求失败不影响后续窗口（且失败不算「上游没内容」）', async () => {
  const upstream = fakeUpstream({
    '全部#0': [playlist('x')],
    // 只给 5 条：这批凑不满 10 个，所以一定会再去问第三个窗口（下面把它弄挂）
    [`${HOT_CATEGORIES[1]}#0`]: Array.from({ length: 5 }, (_, i) => playlist(`b-${i}`)),
  })
  const asked: string[] = []
  const result = await fillHotPlaylists({
    startCursor: 0,
    fetchWindow: (win) => {
      asked.push(`${win.category}#${win.offset}`)
      if (win.category === HOT_CATEGORIES[2]) return Promise.reject(new Error('boom'))
      return upstream.fetchWindow(win)
    },
  })

  assert.deepEqual(asked, ['全部#0', `${HOT_CATEGORIES[1]}#0`, `${HOT_CATEGORIES[2]}#0`])
  assert.equal(result.okWindows, 2, '抛错的那个窗口不算成功')
  assert.equal(result.items.length, 6, '凑不满就少给几张，不能把失败的窗口当成空内容继续凑')
  assert.equal(result.items[0].id, 'x')
  assert.equal(result.exhausted, false, '有内容就不是「没新东西了」')
  assert.deepEqual(
    result.windows.map((win) => win.category),
    ['全部', HOT_CATEGORIES[1]],
    'windows 只收成功窗口（游标推进依赖它，失败的窗口不能算「已消费」）',
  )
  assert.equal(result.attemptedWindows.length, 3, '失败的窗口仍留在诊断信息里')
  assert.deepEqual(
    result.sourceCategories,
    ['全部', HOT_CATEGORIES[1]],
    '挂掉的窗口不进入贡献分类',
  )
})

test('全部窗口都请求失败时 okWindows=0 且不算 exhausted（要保留旧列表而不是擦掉）', async () => {
  const result = await fillHotPlaylists({
    startCursor: 0,
    fetchWindow: () => Promise.reject(new Error('network down')),
  })
  assert.deepEqual(result.items, [])
  assert.equal(result.okWindows, 0)
  assert.equal(result.exhausted, false)
  assert.deepEqual(result.windows, [], '失败窗口不算「已消费」，否则会把没看过的窗口跳过')
  assert.equal(
    result.attemptedWindows.length,
    HOT_MAX_WINDOWS_PER_LOAD,
    '失败的窗口也要留在诊断信息里',
  )
  assert.equal(result.candidateCount, 0)
  assert.equal(result.emptyWindows, 0, '抛错的窗口不是「空响应」')
  assert.deepEqual(result.sourceCategories, [])
})

test('所有窗口都回空列表时不算 exhausted（没取到数据 ≠ 轮完一轮）', async () => {
  const result = await fillHotPlaylists({
    startCursor: 0,
    fetchWindow: () => Promise.resolve([]),
  })
  assert.deepEqual(result.items, [])
  assert.equal(result.okWindows, 3, '窗口都请求成功了，只是没内容')
  assert.equal(result.candidateCount, 0, '一条可用候选都没有')
  assert.equal(result.emptyWindows, 3, '三个成功窗口都是空响应')
  assert.equal(
    result.exhausted,
    false,
    '限流回 200+空列表属于「没取到数据」，当成用尽会误提示「已轮完一轮」并收缩跨批历史',
  )
})

test('1 窗旧数据 + 2 窗空响应：不算 exhausted（candidateCount>0 也不够）', async () => {
  const shown = Array.from({ length: 10 }, (_, i) => playlist(`老-${i}`))
  const upstream = fakeUpstream({
    '全部#0': shown.map((item) => ({ ...item })),
    [`${HOT_CATEGORIES[1]}#0`]: [],
    [`${HOT_CATEGORIES[2]}#0`]: [],
  })
  const result = await fillHotPlaylists({
    startCursor: 0,
    excludeIds: shown.map((item) => item.id),
    fetchWindow: upstream.fetchWindow,
  })

  assert.equal(result.items.length, 0)
  assert.ok(result.candidateCount > 0, '第一个窗口确实给过可用候选')
  assert.equal(result.emptyWindows, 2, '后两个窗口是空响应')
  assert.equal(
    result.exhausted,
    false,
    '只有「每个成功窗口都真的给过候选、且全被历史排除」才算用尽',
  )
})

test('maxWindows 限制请求次数（首页默认最多 3 个）', async () => {
  let asked = 0
  const result = await fillHotPlaylists({
    startCursor: 0,
    fetchWindow: () => {
      asked += 1
      return Promise.resolve([])
    },
  })
  assert.equal(asked, HOT_MAX_WINDOWS_PER_LOAD)
  assert.equal(HOT_MAX_WINDOWS_PER_LOAD, 3)
  assert.equal(result.windows.length, 3)

  asked = 0
  await fillHotPlaylists({
    startCursor: 0,
    maxWindows: 1,
    fetchWindow: () => {
      asked += 1
      return Promise.resolve([])
    },
  })
  assert.equal(asked, 1)
})

test('填充结果里没有重复 id（跨窗口也要去重）', async () => {
  const shared = Array.from({ length: 6 }, (_, i) => playlist(`s-${i}`))
  const result = await fillHotPlaylists({
    startCursor: 0,
    fetchWindow: () => Promise.resolve(shared),
  })
  assert.equal(result.items.length, 6, '三个窗口给同一批，去重后只有 6 个，不能变成 18 个')
  assert.equal(new Set(result.items.map((item) => item.id)).size, 6)
  assert.equal(result.candidateCount, 6, '候选数按 id 去重（跨窗口同一批不重复计数）')
  assert.equal(result.emptyWindows, 0, '窗口有数据就不是空响应')
  // 候选窗口连号展开（分类不同），但后两窗返回的全是已收集的重复 id、
  // 一条都没贡献 → 贡献分类只有第一个窗口的「全部」
  assert.deepEqual(result.sourceCategories, ['全部'])
})

// ---------------------------------------------------------------------------
// 「前缀 + 空载荷」也是不可用 id（review）
//
// 注释与 selectHotPlaylists 的口径都写明「空载荷 id 不可用」，但实现只判了整串是否为
// 空白：`'bilibili:'` / `'gdstudio::'` 整串非空，于是被摆上首页，点进去必然落到无效 id。
// 这类 id 是 provider 拼串时上游字段缺失留下的（见 bilibili.ts 的同类过滤）。
// ---------------------------------------------------------------------------

test('hotPlaylistKey：前缀后无载荷（bilibili: / gdstudio::）与空串同样不可用', () => {
  assert.equal(hotPlaylistKey({ id: '' }), '')
  assert.equal(hotPlaylistKey({ id: 'bilibili:' }), '', '`bilibili:` 点进去必然失败')
  assert.equal(hotPlaylistKey({ id: 'gdstudio::' }), '', '`gdstudio::` 载荷为空')
  assert.equal(hotPlaylistKey({ id: '  bilibili:  ' }), '', 'trim 后同样是空载荷')
  // 正常 id 不受影响
  assert.equal(hotPlaylistKey({ id: 'netease-playlist:1' }), 'id:netease-playlist:1')
  assert.equal(hotPlaylistKey({ id: 'gdstudio:netease:123' }), 'id:gdstudio:netease:123')
  assert.equal(hotPlaylistKey({ id: 'bilibili:BV1xx' }), 'id:bilibili:BV1xx')
})

test('selectHotPlaylists：空载荷 id 不会被摆到首页', () => {
  const picked = selectHotPlaylists([
    playlist('netease-playlist:1'),
    { id: 'bilibili:', title: '空载荷 B 站', resultType: 'playlist' },
    { id: 'gdstudio::', title: '空载荷 gdstudio', resultType: 'playlist' },
    playlist('netease-playlist:2'),
  ])
  assert.deepEqual(
    picked.map((item) => item.id),
    ['netease-playlist:1', 'netease-playlist:2'],
  )
})
