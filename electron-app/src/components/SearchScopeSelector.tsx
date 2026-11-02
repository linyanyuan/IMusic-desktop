/**
 * 搜索框内的音源范围选择器 —— 紧凑 button + menu 下拉。
 *
 * 由 SearchView 原来的 chip 行迁入搜索框右侧：触发器常显当前范围，展开后列出
 * 全部四项及各自说明。键盘可达：Space/Enter 开关菜单，ArrowUp/Down/Home/End 移动
 * 高亮（移动即聚焦），Escape 关闭并回到触发器，点击外部经透明点击层关闭。
 * Tab 不拦截：菜单打开期间触发器退出 Tab 序（tabIndex=-1），正/反向 Tab 都会把焦点
 * 移出容器，再由根节点 onBlurCapture 关闭菜单 —— 若在 Tab 的 keydown 里同步卸载菜单，
 * 当前焦点节点（菜单项）会抢在浏览器默认行为之前消失，焦点掉回 body/页面开头。
 * 焦点回触发器只剩两条安全路径：Escape/选中后的程序化 focus（菜单已关），或点击
 * 触发器（由 click 自己 toggle 关闭）—— 都不与 blur 关闭冲突。
 *
 * 键盘事件约束（见 scopeKeyIntent）：state/shortcuts.ts 在 window keydown 上拦截
 * Space（播放/暂停）和 F（专注模式），只豁免 input/textarea/select —— 所以本组件只拦
 * **自己消费的按键**（Escape / 未修饰的方向键 / Home End / 未修饰 Space、F、Enter），
 * 其余一律冒泡放行：
 * - 带修饰键的组合键（Alt/Ctrl/Meta/**Shift**）**全部放行**。Alt+←/→ 是 NavHistoryControls
 *   挂在 window 上的路由后退/前进（它只豁免 input/textarea/contentEditable，按钮焦点照样
 *   该生效），Ctrl/Meta 组合是系统级命令，Shift+Space / Shift+F 等是用户可自行绑定的
 *   全局快捷键（matchesShortcut 要求修饰键完全一致）—— 它们都绝不能被当成菜单键。
 *   方向键 / Home / End 同理：只在**无修饰**时才是菜单导航。
 * - Tab/Shift+Tab 同样放行：焦点迁移交给浏览器默认行为，关菜单由 onBlurCapture 负责。
 * 注意 Space 不能 preventDefault：原生 button 靠 keyup 触发 click，preventDefault
 * 会把键盘激活吃掉。
 * 拦截规则抽成纯函数 scopeKeyIntent，便于单测（不需要 DOM）。
 *
 * 切换语义不在本组件：这里只上报选择，是否发请求由调用方按 planScopeChange 决定。
 */

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { MusicSearchScope, type MusicSearchScope as Scope } from '../services/models'

export interface ScopeOption {
  key: Scope
  label: string
  hint: string
}

/**
 * 音源范围 —— 对应 MusicSearchScope；四项名称固定（用户指定），顺序即菜单顺序，
 * hint 在菜单项里常显、在触发器上作悬停提示（title）。
 * 「B站歌单」范围按用户要求同时返回 B站歌曲与歌单（有意偏离 Dart，见
 * hybrid.ts searchBilibiliPlaylists）。元组类型即「恰好四项」的契约。
 */
export const SCOPE_OPTIONS: readonly [ScopeOption, ScopeOption, ScopeOption, ScopeOption] = [
  { key: MusicSearchScope.All, label: '全部音源', hint: '元数据单曲 + B站单曲 / 歌单 / 合集（综合搜索）' },
  { key: MusicSearchScope.MetadataSongs, label: '元数据歌曲', hint: '仅元数据音源（GDStudio / Meting），不含 B站' },
  { key: MusicSearchScope.BilibiliPlaylists, label: 'B站歌单', hint: 'B站歌单 + B站单曲' },
  { key: MusicSearchScope.ChkszSongs, label: 'ChKSz', hint: 'ChKSz 网易云，仅单曲；需先在设置里填 API Key' },
]

export interface ScopeChangePlan {
  /** 要提交给 runSearch 的关键词（已 trim）；空串 = 只更新 scope 不发请求 */
  query: string
  /**
   * true = 用了输入框里未提交的文本：调用方必须 route.replaceSearchSeed(query)
   * 保持路由往返一致（且不得写最近搜索）；false = 用的是已提交关键词，seed 本已同步。
   */
  usesUnsubmittedInput: boolean
}

/**
 * 音源范围切换计划（纯逻辑，供单测）：
 * - 重选当前范围 → null（不重复请求）；
 * - 输入框有未提交文本 → 用它（trim 后）并标记 usesUnsubmittedInput；
 * - 输入为空 / 纯空白 → 回退已提交的关键词（输入框被手动清空但结果还在时，
 *   切范围不该把结果清掉）；
 * - 两者皆空 → query ''（searchState.runSearch 对空关键词只更新 scope、不发请求）。
 */
export function planScopeChange(
  current: Scope,
  next: Scope,
  input: string,
  committedQuery: string,
): ScopeChangePlan | null {
  if (next === current) return null
  const trimmedInput = input.trim()
  if (trimmedInput !== '') return { query: trimmedInput, usesUnsubmittedInput: true }
  return { query: committedQuery, usesUnsubmittedInput: false }
}

/** 菜单高亮循环移动（纯逻辑，供单测）；count 为 0 时返回 -1（无可聚焦项） */
export function moveIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return -1
  return (((current + delta) % count) + count) % count
}

/**
 * 键盘事件里本组件关心的最小字段集 —— 结构化类型，单测可直接传普通对象。
 */
export interface ScopeKeyEvent {
  /** KeyboardEvent.key（React 合成事件同名字段） */
  key: string
  /** KeyboardEvent.code：部分键盘布局/IME 下 Space 的 key 不是 ' '，用它兜底 */
  code?: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

/**
 * 一次 keydown 的处理意图：
 * - `pass`：不归本组件管，**不 stopPropagation**（焦点迁移、window 级路由/快捷键照常生效）；
 * - `native`：拦下冒泡但**不 preventDefault**，交给原生 button 激活（Space/Enter）；
 * - `close`：关闭菜单并把焦点交还触发器；
 * - `open`：打开菜单（高亮对齐当前范围）；
 * - `move`：菜单内移动高亮（移动即聚焦），index 为目标下标。
 */
export type ScopeKeyIntent =
  | { type: 'pass' }
  | { type: 'native' }
  | { type: 'close' }
  | { type: 'open' }
  | { type: 'move'; index: number }

export interface ScopeKeyContext {
  open: boolean
  /** 当前高亮下标（菜单打开时等于焦点项） */
  activeIndex: number
  /** 菜单项数量，默认 SCOPE_OPTIONS.length（单测可注入以验证边界） */
  count?: number
}

/**
 * 键盘意图判决（纯逻辑，供单测）：只截获本控件真正消费的按键，其余放行。
 *
 * 放行清单是评审修复的重点 —— 旧的「除 Tab 外一律 stopPropagation」把 window 级
 * Alt+←/→（路由后退/前进）一起挡掉了，焦点在触发器/菜单项上时后退键静默失效。
 */
export function scopeKeyIntent(event: ScopeKeyEvent, ctx: ScopeKeyContext): ScopeKeyIntent {
  const count = ctx.count ?? SCOPE_OPTIONS.length

  // Tab / Shift+Tab：焦点前移后退是浏览器默认行为，关菜单交给 onBlurCapture
  if (event.key === 'Tab') return { type: 'pass' }

  // 带修饰键的组合键全部放行：Alt+←/→ 必须到达 window 上的路由后退/前进；
  // Ctrl/Meta 组合是系统/应用级命令；Shift+Space / Shift+F 等是用户可自定义的绑定
  // （matchesShortcut 要求修饰键完全一致）。它们也绝不能被当成本菜单的方向键 ——
  // 方向键 / Home / End 只在无修饰时才是菜单导航。
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return { type: 'pass' }

  // 未修饰 Space / F 会撞 window 级应用内快捷键（播放/暂停、专注模式）：拦下冒泡，
  // 但保留默认行为让原生 button 在 keyup 上发 click（trigger 开合 / 菜单项选中）。
  if (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space') {
    return { type: 'native' }
  }
  if (event.key === 'f' || event.key === 'F') return { type: 'native' }
  if (event.key === 'Enter') return { type: 'native' }

  // Escape：打开时关闭并交还焦点；关闭时无本组件语义，放行（例如上层弹窗自己处理）
  if (event.key === 'Escape') return ctx.open ? { type: 'close' } : { type: 'pass' }

  if (count <= 0) return { type: 'pass' }

  // 菜单关闭、焦点在触发器上：↓/↑ 展开菜单（与原生 select 一致）
  if (!ctx.open) {
    return event.key === 'ArrowDown' || event.key === 'ArrowUp'
      ? { type: 'open' }
      : { type: 'pass' }
  }

  // 菜单打开：方向键循环移动、Home/End 直达两端
  switch (event.key) {
    case 'ArrowDown':
      return { type: 'move', index: moveIndex(ctx.activeIndex, 1, count) }
    case 'ArrowUp':
      return { type: 'move', index: moveIndex(ctx.activeIndex, -1, count) }
    case 'Home':
      return { type: 'move', index: 0 }
    case 'End':
      return { type: 'move', index: count - 1 }
    default:
      // ArrowLeft/ArrowRight 等本菜单不用的键：放行，不吞掉
      return { type: 'pass' }
  }
}

export interface SearchScopeSelectorProps {
  /** 当前范围（模块级 searchState store 的 scope，跨卸载存活，由 SearchView 传入） */
  scope: Scope
  /** 选择某项时上报；是否发请求由调用方按 planScopeChange 决定 */
  onSelect: (next: Scope) => void
}

export function SearchScopeSelector({ scope, onSelect }: SearchScopeSelectorProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const current = SCOPE_OPTIONS.find((o) => o.key === scope) ?? SCOPE_OPTIONS[0]

  const openMenu = () => {
    // 打开时高亮对齐当前范围（aria-checked 与视觉选中一致），焦点随之进入菜单
    setActiveIndex(SCOPE_OPTIONS.indexOf(current))
    setOpen(true)
  }
  const choose = (next: Scope) => {
    setOpen(false)
    // 焦点回触发器：选择后按 Enter 是重开菜单，不会误触搜索框提交
    triggerRef.current?.focus()
    onSelect(next)
  }

  // 高亮移动即移动焦点（菜单项 tabIndex=-1，Tab 序里只有触发器）
  useEffect(() => {
    if (open) itemRefs.current[activeIndex]?.focus()
  }, [open, activeIndex])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const intent = scopeKeyIntent(e, {
      open,
      activeIndex,
      count: SCOPE_OPTIONS.length,
    })
    // 放行：不拦冒泡 —— Alt+←/→（路由后退/前进）、Ctrl/Meta 组合、Tab 焦点迁移照常生效
    if (intent.type === 'pass') return
    // 以下都是本控件消费的按键：拦下冒泡，防 window 级 Space→播放/暂停、F→专注模式抢响应
    e.stopPropagation()
    // native：不 preventDefault —— 原生 button 的激活靠默认行为（Space 在 keyup 触发 click）
    if (intent.type === 'native') return
    e.preventDefault()
    if (intent.type === 'close') {
      setOpen(false)
      triggerRef.current?.focus()
    } else if (intent.type === 'open') {
      openMenu()
    } else {
      setActiveIndex(intent.index)
    }
  }

  // 焦点离开选择器容器 → 关闭菜单（此时浏览器已完成默认 Tab 焦点迁移，卸载不会再影响去向）。
  // 容器内移动不关闭：打开时 触发器→当前菜单项、方向键 菜单项→菜单项、点击触发器 toggle
  // 时的 菜单项→触发器（由 click 负责关）。键盘无法回到触发器 —— 菜单打开期间它退出了
  // Tab 序（见下），正/反向 Tab 必然离容器而关闭。
  const onBlurCapture = (e: FocusEvent<HTMLDivElement>) => {
    if (!open) return
    const next = e.relatedTarget
    if (next instanceof Node && e.currentTarget.contains(next)) return
    setOpen(false)
  }

  return (
    <div className="relative shrink-0" onKeyDown={onKeyDown} onBlurCapture={onBlurCapture}>
      <button
        ref={triggerRef}
        type="button"
        data-testid="search-scope-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        // 打开期间退出 Tab 序：从首项 Shift+Tab 不会回到触发器（避免「焦点回触发器」与
        // blur 关闭打架），而是直接离开容器 → onBlurCapture 关闭；点击/Escape 的聚焦不受影响
        tabIndex={open ? -1 : 0}
        aria-label={`音源范围：${current.label}（${current.hint}）`}
        title={current.hint}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={`flex items-center gap-1 rounded-md bg-fill px-2 py-1 text-[12px] leading-5 text-primary transition-colors hover:bg-hover ${
          open ? 'relative z-30' : ''
        }`}
      >
        {current.label}
        <ChevronDown
          size={12}
          strokeWidth={2}
          className={`text-secondary transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <>
          {/* 透明点击层：点菜单外任意处关闭并吞掉这次点击（对齐 SongTable 行菜单写法）；
              z-20 < 触发器/菜单 z-30，所以触发器与菜单项仍可点 */}
          <div aria-hidden="true" className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            role="menu"
            aria-label="音源范围"
            className="absolute right-0 top-full z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-subtle bg-card py-1 shadow-[0_12px_32px_rgba(0,0,0,0.12)]"
          >
            {SCOPE_OPTIONS.map((o, i) => {
              const selected = o.key === scope
              return (
                <button
                  key={o.key}
                  ref={(el) => {
                    itemRefs.current[i] = el
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  tabIndex={-1}
                  data-testid={`search-scope-${o.key}`}
                  title={o.hint}
                  onClick={() => choose(o.key)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left outline-none focus:bg-hover"
                >
                  <span className="w-4 shrink-0 pt-0.5">
                    {selected && <Check size={13} strokeWidth={2.5} className="text-accent" />}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block text-[13px] ${selected ? 'font-medium text-accent' : 'text-primary'}`}
                    >
                      {o.label}
                    </span>
                    <span className="block text-[11.5px] leading-4 text-secondary">{o.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
