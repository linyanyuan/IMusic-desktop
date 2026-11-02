// 首页「热门歌单」hook 的纯逻辑部分 —— 来源标签诚实性 + 一批结局的决策口径。
//
// 为什么这里没有 hook 挂载测试：异步挂载 / StrictMode / 路由往返的时序行为由
// 真机验收覆盖（qa/launch-app.cjs + CDP）。本文件锁的是 hook 真的会走的两条纯逻辑：
//   1. 来源标签：兜底走 Hybrid getHotPlaylists（内容可能来自 B 站），绝不能标「网易云」；
//      补窗跨分类时必须写全所有贡献分类（只写第一个 = 误标）。
//   2. decideHotBatch：三种「这一批没有内容」必须分开 —— 请求失败 / 上游空响应 /
//      全是旧面孔。混在一起会误报「已轮完一轮」并收缩跨批去重历史（恢复后旧歌单被
//      重新摆上首页），还会在整批失败时推进游标、把用户没看过的窗口跳过。
//
// 决策测试一律走真实的 fillHotPlaylists 造结果（而不是手写 result 字面量）：
// 手写会把「哪些字段该是什么」抄一遍，测的就不再是生产逻辑。

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_HOT_LIMIT,
  HOT_CATEGORIES,
  HOT_WINDOW_COUNT,
  fillHotPlaylists,
  hotWindowFor,
  type HotWindow,
} from '../src/state/hotRotation'
import {
  HOME_HOT_LIMIT,
  HOT_NOTICE_BATCH_STALE,
  HOT_NOTICE_REFRESH_FAILED,
  HOT_NOTICE_ROUND_DONE,
  HOT_NOTICE_UNAVAILABLE,
  buildFallbackBatch,
  decideHotBatch,
  describeFallbackSource,
  describeHotCategories,
  resetHotSessionForTests,
} from '../src/state/useHotPlaylists'

/** 起始游标 0 时 fillHotPlaylists 会连号问的三个窗口分类 */
const START_CURSOR = 0
const CAT_1 = HOT_CATEGORIES[1] as string
const CAT_2 = HOT_CATEGORIES[2] as string

function playlist(id: string, extra: Record<string, unknown> = {}) {
  return { id, title: `歌单 ${id}`, resultType: 'playlist', ...extra }
}

function pool(prefix: string, count = 10) {
  return Array.from({ length: count }, (_, i) => playlist(`${prefix}-${i}`))
}

/**
 * 假上游：按 `${category}#${offset}` 给数据，没给就**抛错**（模拟网络失败）。
 *
 * 「回空数组」必须显式写成 `[]` —— 空响应与断网是两种不同的上游行为，测试里不能混。
 */
function upstream(pages: Record<string, Array<ReturnType<typeof playlist>>>) {
  const asked: HotWindow[] = []
  return {
    asked,
    fetchWindow: (win: HotWindow) => {
      asked.push(win)
      const rows = pages[`${win.category}#${win.offset}`]
      if (rows == null) throw new Error(`网络失败：${win.category}#${win.offset}`)
      return Promise.resolve(rows)
    },
  }
}

test('HOME_HOT_LIMIT 与轮换默认 limit 一致（每屏 10 个）', () => {
  assert.equal(HOME_HOT_LIMIT, DEFAULT_HOT_LIMIT)
})

test('resetHotSessionForTests 可安全调用（清空模块级会话，供 QA/测试复位）', () => {
  assert.doesNotThrow(() => resetHotSessionForTests())
})

test('describeHotCategories：只写真实分类名（含「全部」），不写第几页', () => {
  assert.equal(describeHotCategories([]), '', '没有贡献分类时不给标签')
  assert.equal(describeHotCategories(['  ', '']), '', '空白分类名不算数')
  /*
    逐个分类断言「原文照抄」，而不是 includes(category)：
    那会放过「网易云 · 华语分类」「网易云 · 华语第 2 页」这种同一分类的多种写法
    （真正的回归就发生在这种地方：`全部` 曾被改写成「热榜」，还在后面挂过页码）。
  */
  for (const category of HOT_CATEGORIES) {
    assert.equal(
      describeHotCategories([category]),
      `网易云 · ${category}`,
      `标签必须原样包含分类名、且不挂页码（实际=${describeHotCategories([category])}）`,
    )
  }
  // 「全部」是最容易被「优化」成营销词的那一格，单独钉住
  assert.equal(describeHotCategories(['全部']), '网易云 · 全部')
})

test('describeHotCategories：多分类如实并列（补窗跨分类时只写第一个 = 误标）', () => {
  assert.equal(
    describeHotCategories(['华语', '民谣']),
    '网易云 · 华语 / 民谣',
    '补窗跨分类时只写第一个分类 = 把民谣内容误标成华语',
  )
  assert.equal(
    describeHotCategories(['华语', '华语', '民谣']),
    '网易云 · 华语 / 民谣',
    '重复分类要去重',
  )
})

test('describeFallbackSource：按条目真实 sourceLabel 标注（绝不把 B 站标成网易云）', () => {
  assert.equal(describeFallbackSource([]), '热门', '空列表不给来源名')
  assert.equal(
    describeFallbackSource([{ sourceLabel: '  ' }, {}]),
    '热门',
    '条目都没带标签时只有「热门」，不虚构来源',
  )
  assert.equal(
    describeFallbackSource([{ sourceLabel: 'B站' }, { sourceLabel: 'B站' }]),
    'B站 · 热门',
    'B站兜底内容必须标 B站',
  )
  assert.equal(
    describeFallbackSource([
      { sourceLabel: '网易云' },
      { sourceLabel: 'B站' },
      { sourceLabel: '网易云' },
    ]),
    '网易云 / B站 · 热门',
    '混合来源如实并列（去重、保持出现顺序）',
  )
  const label = describeFallbackSource([{ sourceLabel: 'B站' }])
  assert.ok(!label.includes('网易云'), 'B站内容绝不允许出现「网易云」字样')
})

// ---------------------------------------------------------------------------
// decideHotBatch：一批的结局判定（hook 的四个业务分支全靠它）
// ---------------------------------------------------------------------------

test('decideHotBatch：拿到新内容 → 上屏，游标按实际消费的窗口推进', async () => {
  const fake = upstream({ [`${HOT_CATEGORIES[0]}#0`]: pool('新') })
  const result = await fillHotPlaylists({
    startCursor: START_CURSOR,
    fetchWindow: fake.fetchWindow,
  })
  const decision = decideHotBatch(result, START_CURSOR)

  assert.equal(decision.kind, 'fill')
  if (decision.kind !== 'fill') return
  assert.equal(decision.items.length, HOME_HOT_LIMIT)
  assert.deepEqual(decision.sourceCategories, [HOT_CATEGORIES[0]])
  assert.equal(
    decision.nextCursor,
    1,
    '只吃了主窗口 → 下一批从下一个窗口开始（不能停在原地重问同一个窗口）',
  )
})

test('decideHotBatch：部分窗口失败但有内容 → 仍然上屏，游标越过最后一个成功窗口', async () => {
  // 主窗口挂掉，第二个窗口给足 10 条
  const fake = upstream({ [`${CAT_1}#0`]: pool('新') })
  const result = await fillHotPlaylists({
    startCursor: START_CURSOR,
    fetchWindow: fake.fetchWindow,
  })
  const decision = decideHotBatch(result, START_CURSOR)

  assert.equal(decision.kind, 'fill', '已经拿到的内容不该因为另一个窗口失败被丢掉')
  if (decision.kind !== 'fill') return
  assert.equal(decision.items.length, 10)
  assert.deepEqual(decision.sourceCategories, [CAT_1], '标签必须写真正供源的分类')
  assert.equal(decision.nextCursor, 2, '失败的主窗口不参与推进，成功窗口之后继续')
})

test('decideHotBatch：整批请求失败 → 暂不可用提示 + 起始游标原地重试', async () => {
  const fake = upstream({})
  const result = await fillHotPlaylists({
    startCursor: START_CURSOR,
    fetchWindow: fake.fetchWindow,
  })
  const decision = decideHotBatch(result, START_CURSOR)

  assert.equal(decision.kind, 'unavailable')
  if (decision.kind !== 'unavailable') return
  assert.equal(decision.notice, HOT_NOTICE_REFRESH_FAILED)
  assert.equal(
    decision.nextCursor,
    START_CURSOR,
    '网络失败绝不能推进游标（否则用户没看过的窗口被跳过；连点还能白走一轮）',
  )
})

test('decideHotBatch：上游回空列表 → 暂不可用提示 + 原地重试（不是「已轮完一轮」）', async () => {
  // 三个候选窗口都成功，但都是 200 + []
  const fake = upstream({
    [`${HOT_CATEGORIES[0]}#0`]: [],
    [`${CAT_1}#0`]: [],
    [`${CAT_2}#0`]: [],
  })
  const result = await fillHotPlaylists({
    startCursor: START_CURSOR,
    fetchWindow: fake.fetchWindow,
  })
  const decision = decideHotBatch(result, START_CURSOR)

  assert.equal(result.okWindows, 3, '前提：窗口本身都请求成功了')
  assert.equal(decision.kind, 'unavailable')
  if (decision.kind !== 'unavailable') return
  assert.equal(decision.notice, HOT_NOTICE_UNAVAILABLE)
  assert.notEqual(decision.notice, HOT_NOTICE_ROUND_DONE, '限流空响应不是「轮完一轮」')
  assert.equal(decision.nextCursor, START_CURSOR, '原地重试同一个窗口，等限流恢复')
})

test('decideHotBatch：1 窗旧数据 + 2 窗空响应 → 暂不可用（不能判成耗尽并清历史）', async () => {
  // 主窗口返回上一批的旧歌单，后两个窗口回空 —— candidateCount>0 且没有请求失败，
  // 但这显然不是「所有候选都被历史排除」，只是那两窗没拿到数据。
  const shown = pool('旧')
  const fake = upstream({
    [`${HOT_CATEGORIES[0]}#0`]: shown.map((item) => ({ ...item })),
    [`${CAT_1}#0`]: [],
    [`${CAT_2}#0`]: [],
  })
  const result = await fillHotPlaylists({
    startCursor: START_CURSOR,
    excludeIds: shown.map((item) => item.id),
    fetchWindow: fake.fetchWindow,
  })
  const decision = decideHotBatch(result, START_CURSOR)

  assert.ok(result.candidateCount > 0, '前提：确实拿到过可用候选')
  assert.equal(result.emptyWindows, 2, '两个窗口空响应')
  assert.equal(decision.kind, 'unavailable', '空窗口必须挡住 exhausted')
  if (decision.kind !== 'unavailable') return
  assert.equal(decision.notice, HOT_NOTICE_UNAVAILABLE)
  assert.equal(decision.nextCursor, START_CURSOR, '旧列表与去重历史都要原样保留')
})

test('decideHotBatch：部分窗口失败 + 其余全是旧面孔 → 刷新失败（网络故障不是用尽）', async () => {
  const shown = pool('旧')
  const fake = upstream({
    [`${HOT_CATEGORIES[0]}#0`]: shown.map((item) => ({ ...item })),
    [`${CAT_1}#0`]: shown.map((item) => ({ ...item })),
    // 第三个窗口没给数据 → 抛错
  })
  const result = await fillHotPlaylists({
    startCursor: START_CURSOR,
    excludeIds: shown.map((item) => item.id),
    fetchWindow: fake.fetchWindow,
  })
  const decision = decideHotBatch(result, START_CURSOR)

  assert.equal(result.okWindows, 2)
  assert.equal(result.exhausted, false, '有窗口失败时不能断定「轮完一轮」')
  assert.equal(decision.kind, 'unavailable')
  if (decision.kind !== 'unavailable') return
  assert.equal(decision.notice, HOT_NOTICE_REFRESH_FAILED)
  assert.equal(decision.nextCursor, START_CURSOR)
})

test('decideHotBatch：只翻 3 个窗口不算整轮 —— 继续换一批，不收缩历史', async () => {
  const shown = pool('旧')
  const fake = upstream({
    [`${HOT_CATEGORIES[0]}#0`]: shown.map((item) => ({ ...item })),
    [`${CAT_1}#0`]: shown.map((item) => ({ ...item })),
    [`${CAT_2}#0`]: shown.map((item) => ({ ...item })),
  })
  const result = await fillHotPlaylists({
    startCursor: START_CURSOR,
    excludeIds: shown.map((item) => item.id),
    fetchWindow: fake.fetchWindow,
  })
  const decision = decideHotBatch(result, START_CURSOR)

  assert.equal(result.exhausted, true, '前提：这 3 个窗口确实全是老面孔')
  assert.equal(decision.kind, 'exhausted')
  if (decision.kind !== 'exhausted') return
  assert.equal(
    decision.roundComplete,
    false,
    '一轮 39 个窗口只翻了 3 个，不能算「轮完一轮」（其余 36 个可能有新歌单）',
  )
  assert.equal(decision.notice, HOT_NOTICE_BATCH_STALE)
  assert.notEqual(decision.notice, HOT_NOTICE_ROUND_DONE, '不能误报整轮耗尽')
  assert.deepEqual(decision.coveredWindows, [0, 1, 2], '把这 3 个窗口记入本轮累计')
  assert.equal(decision.coveredCount, 3)
  assert.equal(decision.nextCursor, 3, '游标照常前进（本批窗口确实翻过了）')
})

test('decideHotBatch：39 个不同窗口都确认无新面孔才算整轮（才允许收缩历史）', async () => {
  const shown = pool('旧')
  const shownIds = shown.map((item) => item.id)
  // 任何窗口都返回同一批旧歌单 → 每一批都是 exhausted
  const fake = {
    fetchWindow: () => Promise.resolve(shown.map((item) => ({ ...item }))),
  }

  let covered: number[] = []
  let cursor = 0
  const batches = HOT_WINDOW_COUNT / 3
  assert.equal(Number.isInteger(batches), true, '测试前提：每批 3 个窗口能整除一轮')

  for (let batch = 1; batch <= batches; batch++) {
    const result = await fillHotPlaylists({
      startCursor: cursor,
      excludeIds: shownIds,
      fetchWindow: fake.fetchWindow,
    })
    const decision = decideHotBatch(result, cursor, covered)
    assert.equal(decision.kind, 'exhausted')
    if (decision.kind !== 'exhausted') return

    if (batch < batches) {
      assert.equal(
        decision.roundComplete,
        false,
        `第 ${batch} 批（共 ${decision.coveredCount} 个窗口）还不够一整轮`,
      )
      assert.equal(decision.notice, HOT_NOTICE_BATCH_STALE)
      assert.equal(decision.coveredCount, batch * 3, '每批 3 个窗口都要记上')
    } else {
      assert.equal(decision.coveredCount, HOT_WINDOW_COUNT)
      assert.equal(decision.roundComplete, true)
      assert.equal(decision.notice, HOT_NOTICE_ROUND_DONE)
      assert.deepEqual(
        decision.coveredWindows,
        [],
        '覆盖完整一轮后累计清零（否则下一轮永远直接判定完成）',
      )
    }
    assert.ok(
      decision.coveredWindows.every((value) => value >= 0 && value < HOT_WINDOW_COUNT),
      '累计集合只收合法窗口下标（天然有界）',
    )
    covered = decision.coveredWindows
    cursor = decision.nextCursor
  }

  // 完整一轮之后从清零的集合重新累计（游标已回绕到 0）
  const next = await fillHotPlaylists({
    startCursor: cursor,
    excludeIds: shownIds,
    fetchWindow: fake.fetchWindow,
  })
  const afterRound = decideHotBatch(next, cursor, covered)
  assert.equal(afterRound.kind, 'exhausted')
  if (afterRound.kind !== 'exhausted') return
  assert.equal(afterRound.roundComplete, false, '清零后不能接着算上一轮')
  assert.equal(afterRound.notice, HOT_NOTICE_BATCH_STALE)
  assert.deepEqual(afterRound.coveredWindows, [0, 1, 2], '新一轮从本批的 3 个窗口开始记')
})

test('decideHotBatch：有新内容上屏 → 本轮「已确认无新面孔」累计清零', async () => {
  const fake = upstream({ [`${HOT_CATEGORIES[0]}#0`]: pool('新') })
  const result = await fillHotPlaylists({
    startCursor: START_CURSOR,
    fetchWindow: fake.fetchWindow,
  })
  // 之前已经确认过若干个窗口没新面孔，但这一批就翻到了新内容
  const decision = decideHotBatch(result, START_CURSOR, [0, 1, 2, 3])

  assert.equal(decision.kind, 'fill')
  if (decision.kind !== 'fill') return
  assert.deepEqual(decision.coveredWindows, [], '有新内容上屏，上一轮累计作废')
})

test('decideHotBatch：unavailable 不记窗口，失败不能被当成「翻过了」', async () => {
  const shown = pool('旧')
  const fake = upstream({
    [`${HOT_CATEGORIES[0]}#0`]: shown.map((item) => ({ ...item })),
    [`${CAT_1}#0`]: shown.map((item) => ({ ...item })),
    // 第三个窗口没给数据 → 抛错
  })
  const result = await fillHotPlaylists({
    startCursor: START_CURSOR,
    excludeIds: shown.map((item) => item.id),
    fetchWindow: fake.fetchWindow,
  })
  const decision = decideHotBatch(result, START_CURSOR, [0])

  assert.equal(decision.kind, 'unavailable')
  assert.equal(
    'coveredWindows' in decision,
    false,
    '失败批次不能往累计里塞窗口（否则会把没看过的窗口算成翻过了）',
  )
  assert.equal(decision.nextCursor, START_CURSOR, '也不能推进游标')})

test('decideHotBatch：累计集合只收 0..HOT_WINDOW_COUNT-1（越界/非整数过滤器）', async () => {
  const shown = pool('旧')
  const fake = upstream({
    [`${HOT_CATEGORIES[0]}#0`]: shown.map((item) => ({ ...item })),
    [`${CAT_1}#0`]: shown.map((item) => ({ ...item })),
    [`${CAT_2}#0`]: shown.map((item) => ({ ...item })),
  })
  const result = await fillHotPlaylists({
    startCursor: START_CURSOR,
    excludeIds: shown.map((item) => item.id),
    fetchWindow: fake.fetchWindow,
  })
  const decision = decideHotBatch(result, START_CURSOR, [
    -1,
    HOT_WINDOW_COUNT,
    3.5,
    Number.NaN,
    0,
  ])

  assert.equal(decision.kind, 'exhausted')
  if (decision.kind !== 'exhausted') return
  assert.deepEqual(
    decision.coveredWindows,
    [0, 1, 2],
    '越界/非整数不进集合，已有的 0 与新累加的 0/1/2 去重',
  )
})

test('decideHotBatch：fillHotPlaylists 自身抛错（result=null）→ 刷新失败 + 原地重试', () => {
  const decision = decideHotBatch(null, 7)
  assert.equal(decision.kind, 'unavailable')
  if (decision.kind !== 'unavailable') return
  assert.equal(decision.notice, HOT_NOTICE_REFRESH_FAILED)
  assert.equal(decision.nextCursor, 7)
})

test('decideHotBatch：末尾游标失败时原地重试仍落在合法范围（不回绕到 0）', async () => {
  const last = HOT_WINDOW_COUNT - 1
  const fake = upstream({})
  const result = await fillHotPlaylists({ startCursor: last, fetchWindow: fake.fetchWindow })
  const decision = decideHotBatch(result, last)

  assert.equal(decision.kind, 'unavailable')
  assert.equal(
    decision.nextCursor,
    last,
    '失败时「原地」就是同一个窗口：归一化不能把它绕成 0（那是另一个分类）',
  )
})

// ---------------------------------------------------------------------------
// buildFallbackBatch：首屏兜底不能丢起始游标
// ---------------------------------------------------------------------------

test('buildFallbackBatch：锚点是本批起点窗口，不是窗口 0（兜底之后从失败处重试）', () => {
  const startWindow = hotWindowFor(9, HOME_HOT_LIMIT)
  const batch = buildFallbackBatch(
    [
      { id: 'netease-playlist:1', title: 'A', sourceLabel: '网易云' },
      { id: 'netease-playlist:2', title: 'B', sourceLabel: '网易云' },
    ],
    startWindow,
  )

  assert.notEqual(batch, null)
  if (batch == null) return
  assert.equal(batch.window.cursor, startWindow.cursor)
  assert.notEqual(batch.window.cursor, 0, '记成窗口 0 会让兜底后的「换一批」偷偷退回开头')
  assert.equal(batch.label, '网易云 · 热门')
  assert.deepEqual(batch.shownIds, ['netease-playlist:1', 'netease-playlist:2'])
  assert.deepEqual(
    batch.items.map((song) => song.id),
    ['netease-playlist:1', 'netease-playlist:2'],
  )
})

test('buildFallbackBatch：兜底也没有可用条目时返回 null（不写空批次）', () => {
  const startWindow = hotWindowFor(3, HOME_HOT_LIMIT)
  assert.equal(buildFallbackBatch([], startWindow), null)
  assert.equal(buildFallbackBatch([{ id: '', title: '空 id' }], startWindow), null)
  assert.equal(buildFallbackBatch([{ id: 'x', resultType: 'song' }], startWindow), null)
})
