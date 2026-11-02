// 音源范围选择器（src/components/SearchScopeSelector.tsx）的回归测试 —— 纯逻辑 + 契约，不渲染 DOM。
//
// 锚点：
//   - 四项名称/顺序/hint 固定（全部音源 / 元数据歌曲 / B站歌单 / ChKSz），key 与
//     MusicSearchScope 一一对应；「B站歌单」有意偏离 Dart：同时收 B站单曲与歌单，hint 必须体现；
//   - planScopeChange：重选当前范围返回 null（不重复请求）；未提交输入非空时用它做关键词并
//     标记 usesUnsubmittedInput（调用方须 route.replaceSearchSeed，且不写最近搜索），否则回退
//     已提交关键词；两者皆空 → query ''（store 对空关键词只更新 scope 不发请求，见 search-state 测试）；
//   - moveIndex：菜单高亮循环移动不越界；
//   - scopeKeyIntent：键盘拦截范围（评审修复）—— 带修饰键的组合键（尤其是 Alt+←/→ 路由
//     后退/前进与 Ctrl/Meta 组合）一律放行，只截获本控件真正消费的键；Space/F/Enter 拦冒泡
//     但保留原生 button 默认激活（不 preventDefault）。

import assert from 'node:assert/strict'
import test from 'node:test'
import { MusicSearchScope } from '../src/services/models'
import {
  SCOPE_OPTIONS,
  moveIndex,
  planScopeChange,
  scopeKeyIntent,
} from '../src/components/SearchScopeSelector'

/** 菜单关闭、焦点在触发器上 */
const closed = { open: false, activeIndex: 0 }
/** 菜单打开、焦点在第 activeIndex 个菜单项上 */
const opened = (activeIndex: number) => ({ open: true, activeIndex })
const LAST = SCOPE_OPTIONS.length - 1

test('SCOPE_OPTIONS：四项固定名称与顺序，hint 齐全，key 与 MusicSearchScope 一一对应且不重复', () => {
  assert.deepEqual(
    SCOPE_OPTIONS.map((o) => o.label),
    ['全部音源', '元数据歌曲', 'B站歌单', 'ChKSz'],
  )
  assert.deepEqual(SCOPE_OPTIONS.map((o) => o.key), [
    MusicSearchScope.All,
    MusicSearchScope.MetadataSongs,
    MusicSearchScope.BilibiliPlaylists,
    MusicSearchScope.ChkszSongs,
  ])
  assert.equal(new Set(SCOPE_OPTIONS.map((o) => o.key)).size, 4, 'key 不得重复')
  for (const o of SCOPE_OPTIONS) assert.ok(o.hint.length > 0, `${o.label} 缺 hint`)

  // 「B站歌单」范围有意偏离 Dart：同时收 B站单曲与歌单，hint 必须体现
  const bili = SCOPE_OPTIONS.find((o) => o.key === MusicSearchScope.BilibiliPlaylists)
  assert.ok(bili != null && bili.hint.includes('单曲'), 'B站歌单 hint 应说明同时包含单曲')
})

test('planScopeChange：重选当前范围返回 null（不重复请求），即使输入框有新文本', () => {
  assert.equal(planScopeChange(MusicSearchScope.All, MusicSearchScope.All, '新歌', '旧词'), null)
  assert.equal(planScopeChange(MusicSearchScope.ChkszSongs, MusicSearchScope.ChkszSongs, '', ''), null)
})

test('planScopeChange：未提交输入非空 → 用输入（trim 后）并标记 usesUnsubmittedInput', () => {
  const plan = planScopeChange(MusicSearchScope.All, MusicSearchScope.BilibiliPlaylists, '  周杰伦  ', '旧词')
  assert.deepEqual(plan, { query: '周杰伦', usesUnsubmittedInput: true })
})

test('planScopeChange：输入为空 / 纯空白 → 回退已提交关键词，不动 seed', () => {
  assert.deepEqual(planScopeChange(MusicSearchScope.All, MusicSearchScope.MetadataSongs, '', '已提交'), {
    query: '已提交',
    usesUnsubmittedInput: false,
  })
  assert.deepEqual(planScopeChange(MusicSearchScope.All, MusicSearchScope.MetadataSongs, '   ', '已提交'), {
    query: '已提交',
    usesUnsubmittedInput: false,
  })
})

test('planScopeChange：输入与已提交关键词都为空 → query 空串（store 只更新 scope 不发请求）', () => {
  const plan = planScopeChange(MusicSearchScope.All, MusicSearchScope.ChkszSongs, '', '')
  assert.deepEqual(plan, { query: '', usesUnsubmittedInput: false })
})

test('moveIndex：循环移动与边界', () => {
  assert.equal(moveIndex(0, 1, 4), 1)
  assert.equal(moveIndex(3, 1, 4), 0, '末位下移回绕到 0')
  assert.equal(moveIndex(0, -1, 4), 3, '首位上移回绕到末位')
  assert.equal(moveIndex(2, 0, 4), 2)
  assert.equal(moveIndex(0, 1, 1), 0, '单项原地')
  assert.equal(moveIndex(0, 1, 0), -1, '空列表无效索引')
})

// ---- scopeKeyIntent：键盘拦截范围 ----
// 评审修复的锚点：旧的「除 Tab 外一律 stopPropagation」把 window 级 Alt+←/→
// （NavHistoryControls 的路由后退/前进）一起挡掉了 —— 焦点在触发器或菜单项上时后退键静默失效。

test('scopeKeyIntent：Alt+←/→ 在触发器焦点与菜单焦点下都放行，且绝不当菜单方向键', () => {
  // 菜单关闭（焦点在触发器）：不能 open、不能 move
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowLeft', altKey: true }, closed), { type: 'pass' })
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowRight', altKey: true }, closed), { type: 'pass' })
  // 菜单打开（焦点在菜单项）：不能被当成左右方向键或上下方向键
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowLeft', altKey: true }, opened(2)), { type: 'pass' })
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowRight', altKey: true }, opened(2)), { type: 'pass' })
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowDown', altKey: true }, opened(1)), { type: 'pass' })
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowUp', altKey: true }, opened(1)), { type: 'pass' })
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowUp', altKey: true }, closed), { type: 'pass' })
  // Home/End 同理：带 Alt 不是菜单跳转
  assert.deepEqual(scopeKeyIntent({ key: 'Home', altKey: true }, opened(1)), { type: 'pass' })
  assert.deepEqual(scopeKeyIntent({ key: 'End', altKey: true }, opened(1)), { type: 'pass' })
})

test('scopeKeyIntent：Ctrl/Meta 等其他组合键正常传播（不当菜单键、也不吞快捷键）', () => {
  for (const mod of ['ctrlKey', 'metaKey', 'shiftKey'] as const) {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowLeft', 'ArrowRight', 'Escape']) {
      assert.deepEqual(
        scopeKeyIntent({ key, [mod]: true }, opened(1)),
        { type: 'pass' },
        `${mod}+${key} 应放行`,
      )
      assert.deepEqual(scopeKeyIntent({ key, [mod]: true }, closed), { type: 'pass' }, `${mod}+${key} 应放行`)
    }
    // Ctrl/Meta/Shift+Space 是用户可自行绑定的组合，不属于本控件的未修饰 Space 拦截
    assert.deepEqual(scopeKeyIntent({ key: ' ', [mod]: true }, closed), { type: 'pass' })
    // Shift+Enter（新窗口/换行语义）、Ctrl+Enter 等也不归本控件
    assert.deepEqual(scopeKeyIntent({ key: 'Enter', [mod]: true }, closed), { type: 'pass' })
  }
})

test('scopeKeyIntent：Shift+Space / Shift+F 放行，不被当成菜单/触发键（保留自定义快捷键语义）', () => {
  // matchesShortcut 要求修饰键完全一致：若用户把某动作绑到 Shift+Space，这里不能吞掉它
  assert.deepEqual(scopeKeyIntent({ key: ' ', shiftKey: true }, closed), { type: 'pass' })
  assert.deepEqual(scopeKeyIntent({ key: ' ', shiftKey: true }, opened(1)), { type: 'pass' })
  assert.deepEqual(scopeKeyIntent({ key: 'f', shiftKey: true }, closed), { type: 'pass' })
  assert.deepEqual(scopeKeyIntent({ key: 'F', shiftKey: true }, opened(2)), { type: 'pass' })
})

test('scopeKeyIntent：Tab / Shift+Tab 放行（焦点迁移交给浏览器默认行为）', () => {
  assert.deepEqual(scopeKeyIntent({ key: 'Tab' }, closed), { type: 'pass' })
  assert.deepEqual(scopeKeyIntent({ key: 'Tab', shiftKey: true }, opened(1)), { type: 'pass' })
})

test('scopeKeyIntent：未修饰 Space / F 拦冒泡但不 preventDefault（保留原生 button 激活）', () => {
  // native = 只 stopPropagation；不能 preventDefault —— 否则 Space 的 click 被吃掉
  assert.deepEqual(scopeKeyIntent({ key: ' ' }, closed), { type: 'native' })
  assert.deepEqual(scopeKeyIntent({ key: ' ' }, opened(1)), { type: 'native' })
  // 部分布局/IME 下 key 不是空格：用 code 兜底（与 matchesShortcut 同款判定）
  assert.deepEqual(scopeKeyIntent({ key: 'Spacebar' }, closed), { type: 'native' })
  assert.deepEqual(scopeKeyIntent({ key: 'Unidentified', code: 'Space' }, closed), { type: 'native' })
  assert.deepEqual(scopeKeyIntent({ key: 'f' }, closed), { type: 'native' })
  assert.deepEqual(scopeKeyIntent({ key: 'F' }, opened(0)), { type: 'native' })
})

test('scopeKeyIntent：Enter 交给原生 button 激活（菜单开/关两态一致）', () => {
  assert.deepEqual(scopeKeyIntent({ key: 'Enter' }, closed), { type: 'native' })
  assert.deepEqual(scopeKeyIntent({ key: 'Enter' }, opened(2)), { type: 'native' })
})

test('scopeKeyIntent：Escape 打开时关闭并还焦点，关闭时放行给上层', () => {
  assert.deepEqual(scopeKeyIntent({ key: 'Escape' }, opened(1)), { type: 'close' })
  assert.deepEqual(scopeKeyIntent({ key: 'Escape' }, closed), { type: 'pass' })
})

test('scopeKeyIntent：关闭态 ↓/↑ 展开菜单，其余导航键（含 ←/→ 与 Home/End）无动作', () => {
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowDown' }, closed), { type: 'open' })
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowUp' }, closed), { type: 'open' })
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'a', 'PageDown']) {
    assert.deepEqual(scopeKeyIntent({ key }, closed), { type: 'pass' }, `${key} 关闭态应放行`)
  }
})

test('scopeKeyIntent：打开态方向键循环移动、Home/End 直达两端', () => {
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowDown' }, opened(0)), { type: 'move', index: 1 })
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowDown' }, opened(LAST)), { type: 'move', index: 0 })
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowUp' }, opened(0)), { type: 'move', index: LAST })
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowUp' }, opened(2)), { type: 'move', index: 1 })
  assert.deepEqual(scopeKeyIntent({ key: 'Home' }, opened(2)), { type: 'move', index: 0 })
  assert.deepEqual(scopeKeyIntent({ key: 'End' }, opened(1)), { type: 'move', index: LAST })
  // 本菜单不用左右键：打开态也放行，不吞掉
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowLeft' }, opened(1)), { type: 'pass' })
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowRight' }, opened(1)), { type: 'pass' })
})

test('scopeKeyIntent：空菜单（count=0）不产生非法高亮下标', () => {
  assert.deepEqual(scopeKeyIntent({ key: 'ArrowDown' }, { open: true, activeIndex: 0, count: 0 }), {
    type: 'pass',
  })
  assert.deepEqual(scopeKeyIntent({ key: 'End' }, { open: true, activeIndex: 0, count: 0 }), { type: 'pass' })
})
