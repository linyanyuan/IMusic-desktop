// 今日精选轮播的纯逻辑锚点 —— 停靠位、滚动像素位置、焦点 reveal 与自动播放条件。
//
// 组件本体是 React（悬停暂停 / 键盘 / 减少动画 / 多卡滑动的视觉归真机 QA 验证），
// 这里钉住渲染与滚动都依赖的纯函数：它们错了，轮播就会指到不存在的位置、
// 末尾对不齐留空白、Tab 到视口外卡片不 reveal、或在「减少动态效果」下仍自动播放。
//
// 关键几何：每个卡位 `flex: 0 0 100/3%`，视口带负外边距抵消卡内 gutter，
// 所以 step（单卡宽）同时是停靠步长；scrollLeft = start × step，
// 最大滚动距离 = (count - 3) × step —— 末卡右缘贴齐视口右缘。

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FEATURED_AUTOPLAY_MS,
  FEATURED_VISIBLE,
  SCROLL_SETTLE_MS,
  isHorizontalWheelIntent,
  isModifierCombo,
  maxStartIndex,
  revealStart,
  scrollLeftForIndex,
  shouldAutoplay,
  slideBasisPercent,
  startIndexFromScroll,
  wrapIndex,
} from '../src/components/FeaturedCarousel'

test('wrapIndex：正向越界回绕到 0', () => {
  assert.equal(wrapIndex(0, 8), 0)
  assert.equal(wrapIndex(7, 8), 7)
  assert.equal(wrapIndex(8, 8), 0)
  assert.equal(wrapIndex(9, 8), 1)
})

test('wrapIndex：负下标回绕到末尾（上一张从首屏跳到末屏）', () => {
  assert.equal(wrapIndex(-1, 8), 7)
  assert.equal(wrapIndex(-8, 8), 0)
  assert.equal(wrapIndex(-9, 8), 7)
})

test('wrapIndex：0/1 个位置、小数与非法输入安全归 0', () => {
  assert.equal(wrapIndex(3, 0), 0)
  assert.equal(wrapIndex(-1, 0), 0)
  assert.equal(wrapIndex(3, 1), 0)
  assert.equal(wrapIndex(-1, 1), 0)
  assert.equal(wrapIndex(2.9, 8), 2)
  assert.equal(wrapIndex(Number.NaN, 8), 0)
  assert.equal(wrapIndex(Number.POSITIVE_INFINITY, 8), 0)
})

test('FEATURED_VISIBLE：PC 一屏并排 3 张卡', () => {
  assert.equal(FEATURED_VISIBLE, 3)
})

test('maxStartIndex：最后停靠位置让末卡贴齐右缘', () => {
  assert.equal(maxStartIndex(8, 3), 5, '8 张 3 可见 → 位置 0..5，末屏展示 6/7/8')
  assert.equal(maxStartIndex(4, 3), 1)
  assert.equal(maxStartIndex(3, 3), 0, '一屏正好全显，不需要滑动')
  assert.equal(maxStartIndex(2, 3), 0)
  assert.equal(maxStartIndex(1, 3), 0)
  assert.equal(maxStartIndex(0, 3), 0)
})

test('maxStartIndex：非法输入安全归 0', () => {
  assert.equal(maxStartIndex(Number.NaN, 3), 0)
  assert.equal(maxStartIndex(8, 0), 0)
  assert.equal(maxStartIndex(8, -1), 0)
  assert.equal(maxStartIndex(8, Number.NaN), 0)
})

test('slideBasisPercent：卡位占比 = 100 / 一屏张数', () => {
  assert.ok(Math.abs(slideBasisPercent(3) - 100 / 3) < 1e-9)
  assert.equal(slideBasisPercent(2), 50, '不足 3 张时卡位等分拉宽（2 张各占一半）')
  assert.equal(slideBasisPercent(1), 100)
  assert.equal(slideBasisPercent(0), 100, '非法 visible 退化为 100% 安全值')
})

test('scrollLeftForIndex：停靠位 × 卡宽，末尾贴齐不留空白', () => {
  const step = 320
  const count = 8
  const positions = maxStartIndex(count, FEATURED_VISIBLE) + 1 // 6
  const viewportWidth = FEATURED_VISIBLE * step
  const contentWidth = count * step
  const maxScroll = contentWidth - viewportWidth // = 5 * step

  assert.equal(scrollLeftForIndex(0, step, maxScroll), 0)
  assert.equal(scrollLeftForIndex(1, step, maxScroll), step)
  // 关键对齐：末屏 scrollLeft + 视口宽 = 内容总宽 → 最后一张卡右缘贴齐视口右缘
  const last = scrollLeftForIndex(positions - 1, step, maxScroll)
  assert.equal(last, maxScroll)
  assert.equal(last + viewportWidth, contentWidth)
})

test('scrollLeftForIndex：越界/负下标/非法输入安全收敛', () => {
  const step = 300
  const maxScroll = 1500
  assert.equal(scrollLeftForIndex(999, step, maxScroll), maxScroll, '不会滚出可滚范围')
  assert.equal(scrollLeftForIndex(-2, step, maxScroll), 0)
  assert.equal(scrollLeftForIndex(1.9, step, maxScroll), step, '小数截断到整数停靠位')
  assert.equal(scrollLeftForIndex(3, 0, maxScroll), 0, '未布局（step=0）时归 0')
  assert.equal(scrollLeftForIndex(3, Number.NaN, maxScroll), 0)
  assert.equal(scrollLeftForIndex(3, step, Number.NaN), 0)
  assert.equal(scrollLeftForIndex(3, step, -10), 0)
  assert.equal(scrollLeftForIndex(Number.NaN, step, maxScroll), 0)
})

test('startIndexFromScroll：滚动位置 → 最近停靠位（含四舍五入与循环）', () => {
  const step = 300
  const positions = 6
  assert.equal(startIndexFromScroll(0, step, positions), 0)
  assert.equal(startIndexFromScroll(step, step, positions), 1)
  assert.equal(startIndexFromScroll(step * 1.4, step, positions), 1, '未过半不跳位')
  assert.equal(startIndexFromScroll(step * 1.6, step, positions), 2, '过半进到下一停靠位')
  assert.equal(startIndexFromScroll(step * 5, step, positions), 5)
  assert.equal(startIndexFromScroll(step * positions, step, positions), 0, '越界回绕')
  assert.equal(startIndexFromScroll(step, 0, positions), 0, 'step=0 安全归 0')
  assert.equal(startIndexFromScroll(Number.NaN, step, positions), 0)
})

test('滚动位置与停靠位互为逆运算（每个停靠位都能精确回来）', () => {
  for (const [count, step] of [
    [8, 300],
    [4, 333.3333],
    [10, 427],
  ] as const) {
    const positions = maxStartIndex(count, FEATURED_VISIBLE) + 1
    const maxScroll = (count - FEATURED_VISIBLE) * step
    for (let i = 0; i < positions; i++) {
      const left = scrollLeftForIndex(i, step, maxScroll)
      assert.equal(startIndexFromScroll(left, step, positions), i, `count=${count} i=${i}`)
    }
  }
})

test('不足一屏时没有可滚距离（≤3 张全部展示、无翻页控件）', () => {
  for (const count of [0, 1, 2, 3]) {
    const positions = maxStartIndex(count, FEATURED_VISIBLE) + 1
    assert.equal(positions, 1)
    assert.equal(scrollLeftForIndex(0, 300, 0), 0)
    assert.equal(startIndexFromScroll(0, 300, positions), 0)
  }
})

test('revealStart：卡片已在视口内时视图不动（Tab 在可见卡间移动不乱滑）', () => {
  assert.equal(revealStart(0, 0, 8, 3), 0)
  assert.equal(revealStart(0, 1, 8, 3), 0)
  assert.equal(revealStart(0, 2, 8, 3), 0)
  assert.equal(revealStart(3, 4, 8, 3), 3)
})

test('revealStart：焦点落到视口右侧外 → 该卡成为末卡', () => {
  assert.equal(revealStart(0, 3, 8, 3), 1, '第 4 张获焦 → 窗口滑到 1..3')
  assert.equal(revealStart(1, 5, 8, 3), 3)
  assert.equal(revealStart(0, 7, 8, 3), 5, '末卡获焦 → 夹在 maxStartIndex')
})

test('revealStart：焦点落到视口左侧外 → 该卡成为首卡', () => {
  assert.equal(revealStart(3, 1, 8, 3), 1)
  assert.equal(revealStart(2, 0, 8, 3), 0)
})

test('revealStart：一屏全显时恒为 0', () => {
  assert.equal(revealStart(0, 0, 3, 3), 0)
  assert.equal(revealStart(0, 2, 3, 3), 0)
  assert.equal(revealStart(0, 1, 2, 3), 0)
})

test('revealStart 不变式：任意停靠位下 focus 任意卡，该卡必落在可见窗口内', () => {
  const count = 8
  const max = maxStartIndex(count, FEATURED_VISIBLE)
  for (let start = 0; start <= max; start++) {
    for (let index = 0; index < count; index++) {
      const next = revealStart(start, index, count)
      assert.ok(next >= 0 && next <= max, `start=${start} index=${index} → ${next} 越界`)
      assert.ok(
        index >= next && index < next + FEATURED_VISIBLE,
        `start=${start} index=${index} → ${next} 未把焦点卡放进可见窗口`,
      )
      // 已在视口内就不该动：避免 Tab 在可见卡之间移动时视图乱滑
      if (index >= start && index < start + FEATURED_VISIBLE) {
        assert.equal(next, start)
      }
    }
  }
})

test('shouldAutoplay：只在一屏放不下、未暂停、未减少动画时成立', () => {
  assert.equal(shouldAutoplay(8, false, false), true)
  assert.equal(shouldAutoplay(4, false, false), true, '4 张仍超出一屏，需要轮播')
  assert.equal(shouldAutoplay(3, false, false), false, '3 张一屏全显，无需轮播')
  assert.equal(shouldAutoplay(2, false, false), false)
  assert.equal(shouldAutoplay(1, false, false), false)
  assert.equal(shouldAutoplay(0, false, false), false)
  assert.equal(shouldAutoplay(8, true, false), false, '悬停/焦点进入时暂停')
  assert.equal(shouldAutoplay(8, false, true), false, '减少动态效果时不自动播放')
  assert.equal(shouldAutoplay(8, true, true), false)
})

test('循环：末尾再下一张回起始，起始再上一张到末尾', () => {
  const positions = maxStartIndex(8, FEATURED_VISIBLE) + 1 // 6 个停靠位置
  assert.equal(wrapIndex(positions, positions), 0, '末屏（start=5）再下一张 → 回第 1 屏')
  assert.equal(wrapIndex(-1, positions), positions - 1, '第 1 屏再上一张 → 到末屏')
})

test('自动播放间隔为正、不过分频繁，且留足滚动收尾时间', () => {
  assert.ok(Number.isFinite(FEATURED_AUTOPLAY_MS) && FEATURED_AUTOPLAY_MS >= 3000)
  assert.ok(
    Number.isFinite(SCROLL_SETTLE_MS) && SCROLL_SETTLE_MS > 0 && SCROLL_SETTLE_MS < FEATURED_AUTOPLAY_MS,
    '滚动兜底计时必须短于自动播放间隔，否则两次切换的 pending 会互相踩',
  )
})

// ── 圆点命中区 ───────────────────────────────────────────────────────────────────────────
// 视觉上是 6px 小点，但按钮的可点击/可聚焦区域是 Tailwind `h-6 w-6` = 24×24
// （WCAG 2.2 最小目标尺寸）：6px 的点对鼠标是像素狩猎，对键盘也看不出焦点环在哪。
// 这是纯样式约定，node 侧测不了真实盒子 —— 由主 agent 用 CDP 量实际可点击尺寸。

// ── 滚轮意图 ───────────────────────────────────────────────────────────────
// 轮播嵌在纵向滚动的首页里：滚动视口同样会收到「用户只是在滚页」的 wheel 事件。
// 若一律清 pending，平滑滚动的中间位置会被当成停靠位，圆点闪一串再落回目标。
test('滚轮意图：纯纵向滚页不算横向意图（不打断程序化滚动）', () => {
  assert.equal(isHorizontalWheelIntent(0, 120), false)
  assert.equal(isHorizontalWheelIntent(0, -120), false)
  assert.equal(isHorizontalWheelIntent(0, 0), false)
  assert.equal(isHorizontalWheelIntent(0.4, 100), false, '触控板纵向滑动常带微小抖动')
})

test('滚轮意图：|deltaX| 严格大于 |deltaY| 才算横向主导', () => {
  assert.equal(isHorizontalWheelIntent(120, 0), true)
  assert.equal(isHorizontalWheelIntent(120, 5), true)
  assert.equal(isHorizontalWheelIntent(-120, 5), true, '向左滑同样是有意为之（取绝对值）')
  assert.equal(isHorizontalWheelIntent(10, 100), false, '斜向但纵向主导 → 仍视作滚页')
  assert.equal(isHorizontalWheelIntent(100, 100), false, '45° 对角线不动，宁可少打断')
})

test('滚轮意图：Shift+纵向滚轮 = 浏览器的横向映射', () => {
  assert.equal(isHorizontalWheelIntent(0, 120, true), true)
  assert.equal(isHorizontalWheelIntent(0, -120, true), true)
  assert.equal(isHorizontalWheelIntent(0, 0, true), false, '没有位移就不算任何意图')
})

test('滚轮意图：非法数值安全收敛（不抛错、不伪造横向意图）', () => {
  assert.equal(isHorizontalWheelIntent(Number.NaN, Number.NaN), false)
  assert.equal(isHorizontalWheelIntent(Number.NaN, 120), false)
  assert.equal(isHorizontalWheelIntent(Number.POSITIVE_INFINITY, 120), false)
  assert.equal(isHorizontalWheelIntent(120, Number.NaN), true)
})

// ── 修饰键放行 ─────────────────────────────────────────────────────────────
// Alt+←/→ 是 NavHistoryControls 的路由后退/前进（浏览器惯例）；Shift/Ctrl/Meta 则是
// 用户自定义全局快捷键的常用修饰键（如 Shift+F、Shift+Space）。轮播的 onKeyDown
// 一旦 preventDefault + stopPropagation，这些键就在轮播区域内失灵 ——
// 轮播是页面主体的一部分，只能消费**完全无修饰**的方向键与 Space/F。
test('带修饰键的组合键一律原样上抛（Alt+←/→ = 路由前进后退）', () => {
  assert.equal(isModifierCombo({ altKey: true }), true)
  assert.equal(isModifierCombo({ ctrlKey: true }), true)
  assert.equal(isModifierCombo({ metaKey: true }), true)
  assert.equal(isModifierCombo({ shiftKey: true }), true, 'Shift+F / Shift+Space 等自定义全局快捷键')
  assert.equal(isModifierCombo({ ctrlKey: true, shiftKey: true, altKey: true }), true)
})

test('无修饰键的 ←/→、Home/End、Space、F 仍归轮播（不误放行）', () => {
  assert.equal(isModifierCombo({}), false)
  assert.equal(isModifierCombo({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }), false)
})
