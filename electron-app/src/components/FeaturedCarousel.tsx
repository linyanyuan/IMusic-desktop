/**
 * 今日精选轮播 —— 日期种子分类精选歌单的多卡滑动窗。
 *
 * 形态：一屏并排 FEATURED_VISIBLE(3) 张方形封面卡（标题/作者在封面下方），左右箭头、
 * 圆点与自动轮播推动一条横向轨道逐卡滑动，到末尾循环回起始 —— 不是单张大横幅淡入淡出。
 *
 * 为什么用原生水平滚动而不是 transform：仓库约束「视图切换/动画不用 transform」。
 * 轨道放进 `overflow-x: auto` 的滚动视口，每个卡位 `flex: 0 0 100/3%` +
 * `snap-start`，翻页 = `viewport.scrollTo({ left: index * step })`。好处：
 * ① 触控板/触摸横向拖动天然可用；② 焦点落到视口外卡片时浏览器自己会把它滚进视口，
 * 再按停靠位对齐，不会出现「焦点在屏幕外却看不见」；③ 滚动位置是唯一真相，
 * 窗口尺寸变化只需按新卡宽重新对齐 —— 不像 translateX 百分比那样依赖轨道宽度假设。
 *
 * 对齐算式（单测钉住）：step = 卡位宽 = (视口宽 + 2×gutter) / 3 —— 视口带
 * `-mx-2.5` 负外边距抵消卡内 `px-2.5` gutter，卡片左右缘仍与内容区对齐；
 * 停在 start 时 scrollLeft = start × step；最后停靠位 maxStartIndex = count - 3，
 * 末卡右缘恰好贴齐视口右缘，不留空白。
 *
 * 交互约定：
 * - 自动播放（FEATURED_AUTOPLAY_MS）：纯挂钟 setInterval，不用 rAF
 *   （窗口隐藏/最小化时 Chromium 停发 rAF，rAF 收尾的 promise 链会永久挂起）；
 * - 鼠标悬停或键盘焦点进入轮播区域时暂停，离开恢复；
 * - prefers-reduced-motion: reduce 时不自动播放，翻页不做平滑动画；
 * - 上一张/下一张按钮 + 圆点直跳；←/→ 翻页、Home/End 跳首尾；到末尾循环回起始；
 * - 圆点的**命中区**是 24×24（Tailwind `h-6 w-6`，WCAG 2.2 目标尺寸下限），
 *   视觉上仍是 6px 小点 / 20px 选中短线 —— 点太小只是看起来精致，鼠标和键盘都点不准；
 * - 0 张不渲染；≤ FEATURED_VISIBLE 张时一屏全显（卡位等分拉宽）：不出现翻页按钮/圆点，
 *   也不挂计时器；
 * - Tab 把焦点移到视口外卡片的控件上时，把该卡 reveal 进视口（并保持停靠位对齐）；
 * - 程序化滚动用「目标位置 + 挂钟兜底」跟踪：动画途中的中间 scroll 事件被忽略，
 *   完成或超时（隐藏窗口/被手动拖动打断）后以实际位置收尾，不会卡在中间态。
 *
 * 键盘事件注意：state/shortcuts.ts 的 window keydown 会把 button 上的 Space 拦成
 * 播放/暂停（并 preventDefault）、把 F 拦成专注模式切换。轮播区域的 onKeyDown 对
 * 这些键 stopPropagation —— Space/Enter 才能正常激活按钮，F 才不会误切专注模式。
 *
 * 反过来，**带修饰键的组合键必须原样放行**（`isModifierCombo`）：Alt+←/→ 是
 * NavHistoryControls 的路由后退/前进；Ctrl/Shift/Meta 是用户自定义全局快捷键的常用修饰键
 * （如 Shift+F 切换专注、Shift+Space 播放暂停）。轮播只消费**无修饰**的 ←/→/Home/End
 * 以及 Space/F —— 它是页面主体的一部分，不该劫持别人的快捷键。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Play } from 'lucide-react'
import { DeskRoute, useRoute } from '../state/route'
import { usePlayPlaylist } from '../state/playPlaylist'
import { songCover } from '../state/songUtils'
import { Cover } from './Cover'
import type { Song } from '../services/models'

/** 自动播放间隔（毫秒） */
export const FEATURED_AUTOPLAY_MS = 6000

/** 一屏并排的卡片数（PC 桌面固定 3 张，卡片宽度随容器自适应） */
export const FEATURED_VISIBLE = 3

/**
 * 程序化滚动的挂钟兜底时长：`scrollTo({behavior:'smooth'})` 在隐藏窗口里可能
 * 根本推进不了，靠 scroll 事件永远等不到终点 —— 超时后按实际位置收尾。
 */
export const SCROLL_SETTLE_MS = 700

/**
 * 这次滚轮事件是否表达了**横向**滚动意图（只有它才该打断进行中的程序化滚动）。
 *
 * 为什么不看「wheel 就行」：轮播嵌在纵向滚动的首页里，用户滚页时滚动视口同样收到
 * wheel 事件。若一律清掉 pending，平滑滚动的中间位置就会被 onScroll 当成停靠位，
 * 圆点在 0→1→2 之间闪一串再落回目标 —— 而页面其实只是在纵向滚动。
 *
 * 判定口径：
 * - `|deltaX|` 严格大于 `|deltaY|` 才算横向主导（对角线 45° 不动，宁可少打断）；
 * - Shift + 纵向滚轮在 Chromium/Windows 上被映射成「横向滚动」（上报 deltaX=0、
 *   deltaY=±100），所以 shiftKey 且 deltaX 为 0 时按横向意图处理；
 * - 纯纵向（deltaX=0）一律 false；非法数值按 0 处理。
 */
export function isHorizontalWheelIntent(
  deltaX: number,
  deltaY: number,
  shiftKey = false,
): boolean {
  const dx = Number.isFinite(deltaX) ? Math.abs(deltaX) : 0
  const dy = Number.isFinite(deltaY) ? Math.abs(deltaY) : 0
  if (dx === 0) return shiftKey && dy > 0
  return dx > dy
}

/**
 * 是否带修饰键（Ctrl/Alt/Shift/Meta）—— 这类组合键不归轮播，必须原样上抛。
 *
 * 两个典型冲突：
 * - Alt+←/→ 被 NavHistoryControls 当作路由后退/前进，而轮播的 onKeyDown 会
 *   preventDefault + stopPropagation，于是「焦点在今日精选里就退不了页面」；
 * - 用户可在设置里把全局快捷键配成 Shift+F / Shift+Space 这类组合，轮播若拦掉
 *   Shift 就等于把这些键吃掉。
 * 轮播因此只消费**完全无修饰**的 ←/→/Home/End 与 Space/F。
 */
export function isModifierCombo(event: {
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
}): boolean {
  return (
    event.ctrlKey === true ||
    event.altKey === true ||
    event.shiftKey === true ||
    event.metaKey === true
  )
}

/**
 * 轮播下标取模归一化：负下标/越界都收敛到 [0, count)，count<=0 或非法输入归 0。
 * 渲染侧始终经它换算 —— 歌单数量变化时当前位置自然收敛，不会指向不存在的位置。
 */
export function wrapIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) return 0
  const i = Math.trunc(index)
  return ((i % count) + count) % count
}

/**
 * 滑动窗起始位置的最大值：最后停靠位置让最后一张卡恰好贴齐视口右缘。
 * count ≤ visible 时为 0（一屏已全显，无需也不能滑动）；非法输入安全归 0。
 */
export function maxStartIndex(count: number, visible: number = FEATURED_VISIBLE): number {
  if (!Number.isFinite(count) || !Number.isFinite(visible) || visible <= 0) return 0
  return Math.max(0, Math.trunc(count) - Math.trunc(visible))
}

/** 每张卡的 flex-basis 百分比（相对视口内容宽）；visible 非法时退化为 100% 安全值 */
export function slideBasisPercent(visible: number = FEATURED_VISIBLE): number {
  if (!Number.isFinite(visible) || visible <= 0) return 100
  return 100 / Math.trunc(visible)
}

/**
 * 某个停靠位对应的 scrollLeft：index × 单卡宽，夹到 [0, maxScroll]。
 * maxScroll 由滚动视口实测（scrollWidth - clientWidth），末尾贴齐不留空白；
 * step/maxScroll 非法（未布局、隐藏、0 宽）时安全归 0。
 */
export function scrollLeftForIndex(index: number, step: number, maxScroll: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0
  const max = Number.isFinite(maxScroll) && maxScroll > 0 ? maxScroll : 0
  const raw = (Number.isFinite(index) ? Math.trunc(index) : 0) * step
  return Math.min(Math.max(raw, 0), max)
}

/**
 * 当前 scrollLeft 落在哪个停靠位：四舍五入到最近的卡边界再归一到 [0, positions)。
 * 手动拖动/浏览器 focus 滚动后靠它把「滚动位置」同步回「停靠下标」。
 */
export function startIndexFromScroll(
  scrollLeft: number,
  step: number,
  positions: number,
): number {
  if (!Number.isFinite(scrollLeft) || !Number.isFinite(step) || step <= 0) return 0
  return wrapIndex(Math.round(scrollLeft / step), positions)
}

/**
 * 焦点 reveal：第 index 张卡获得焦点时，滑动窗该停在哪个起始位置。
 * 已在视口内（[start, start+visible)）则不动，避免 Tab 在可见卡之间移动时视图乱滑；
 * 在视口左侧外则让它当首卡，右侧外则让它当末卡；结果始终夹在 [0, maxStartIndex]。
 */
export function revealStart(
  start: number,
  index: number,
  count: number,
  visible: number = FEATURED_VISIBLE,
): number {
  const max = maxStartIndex(count, visible)
  if (index < start) return Math.min(Math.max(Math.trunc(index), 0), max)
  if (index > start + visible - 1) {
    return Math.min(Math.max(Math.trunc(index) - Math.trunc(visible) + 1, 0), max)
  }
  return Math.min(Math.max(start, 0), max)
}

/** 是否允许自动播放：一屏放不下（count > visible）、未暂停（悬停/焦点在区域内）、用户未要求减少动态效果 */
export function shouldAutoplay(count: number, paused: boolean, reducedMotion: boolean): boolean {
  return count > FEATURED_VISIBLE && !paused && !reducedMotion
}

/** 系统是否要求「减少动态效果」（非浏览器环境下安全归 false，便于模块被 node 测试导入） */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** 滚动视口还能滚多远（内容宽 - 视口宽）；未布局时安全归 0 */
function maxScrollOf(viewport: HTMLElement): number {
  return Math.max(0, viewport.scrollWidth - viewport.clientWidth)
}

/** 精选歌单方卡 —— 封面 + 标题 + 作者；点卡片进合集详情，hover 播放键整单播放（取不到曲目则进详情）。
 *  结构与首页热门歌单 PlaylistCard 一致：整卡点击由末尾的透明覆盖按钮承担，
 *  播放键是独立 button 并抬到 z-10 浮在覆盖按钮之上（不能嵌套 button）。 */
function FeaturedPlaylistCard({ playlist }: { playlist: Song }) {
  const route = useRoute()
  const { resolving, playAll } = usePlayPlaylist(playlist)
  const open = () => route.go(DeskRoute.PlaylistDetail, { playlistId: playlist.id })
  const subtitle = playlist.extra['subtitle']?.toString() ?? playlist.artist

  return (
    <div className="group relative text-left">
      <div className="relative overflow-hidden rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.05)] transition-shadow duration-300 group-hover:shadow-[0_10px_28px_rgba(0,0,0,0.14)]">
        {/* size=0 约定：不下发内联宽高，由 className 撑满卡位（aspect-square） */}
        <Cover
          src={songCover(playlist)}
          size={0}
          radius="rounded-xl"
          seed={playlist.title}
          className="!h-auto aspect-square w-full transition-transform duration-500 group-hover:scale-105"
          iconSize={30}
        />
        <button
          type="button"
          aria-label={`播放精选歌单 ${playlist.title}`}
          disabled={resolving}
          onClick={() => void playAll()}
          className="pointer-events-none absolute bottom-2 right-2 z-10 flex h-9 w-9 translate-y-1 items-center justify-center rounded-full bg-card/85 text-accent opacity-0 shadow-md backdrop-blur-md transition-all duration-300 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:translate-y-0 focus-visible:opacity-100 disabled:opacity-100"
        >
          {resolving ? (
            <Loader2 size={15} strokeWidth={2} className="animate-spin" />
          ) : (
            <Play size={15} strokeWidth={2} fill="currentColor" className="ml-[1px]" />
          )}
        </button>
      </div>
      <div className="mt-2 line-clamp-2 text-[13.5px] font-medium leading-snug text-primary">
        {playlist.title}
      </div>
      <div className="truncate text-[12px] text-secondary">{subtitle}</div>
      {/* 整卡点击进详情：透明按钮铺满卡片（含标题区），放在最后 → 盖在封面与文字之上 */}
      <button
        type="button"
        data-featured-card
        aria-label={`查看精选歌单 ${playlist.title}`}
        onClick={open}
        className="absolute inset-0 rounded-xl"
      />
    </div>
  )
}

export function FeaturedCarousel({ playlists }: { playlists: Song[] }) {
  const count = playlists.length
  // 可停靠的起始位置数：8 张 × 3 可见 → 6 个位置（0..5，最后位置展示 6/7/8）
  const positions = maxStartIndex(count, FEATURED_VISIBLE) + 1
  // 一屏内张数：不足 3 张时让卡位等分拉宽（2 张各占一半），而不是挤在左侧
  const perView = Math.max(1, Math.min(FEATURED_VISIBLE, count))
  const [startIndex, setStartIndex] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)

  const viewportRef = useRef<HTMLDivElement | null>(null)
  /** 当前（期望）停靠下标；定时器/连续点击都在事件里同步读它，避免读到过期的 state */
  const startRef = useRef(0)
  /** 进行中的程序化滚动：目标下标/像素位置 + 挂钟兜底 timer */
  const pendingRef = useRef<{ index: number; left: number; timer: number } | null>(null)

  // 跟随系统「减少动态效果」设置实时切换
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // 渲染用的起始位置永远经过归一化：count 变化时不会越界
  const start = wrapIndex(startIndex, positions)

  /** 实测单卡宽（= 一个停靠步长）；未布局/隐藏窗口时用视口宽估算 */
  const measureStep = useCallback(() => {
    const viewport = viewportRef.current
    if (viewport == null) return 0
    const first = viewport.firstElementChild as HTMLElement | null
    const width = first?.getBoundingClientRect().width ?? 0
    if (width > 0) return width
    if (viewport.clientWidth <= 0) return 0
    return viewport.clientWidth / Math.max(1, Math.min(FEATURED_VISIBLE, count))
  }, [count])

  const clearPending = useCallback(() => {
    const pending = pendingRef.current
    if (pending == null) return
    window.clearTimeout(pending.timer)
    pendingRef.current = null
  }, [])

  /**
   * 滚到第 index 个停靠位（循环归一化）。程序化滚动登记为 pending：
   * scroll 监听忽略动画中间位置，到达目标（或挂钟超时）后再以实际位置收尾。
   * `behavior` 缺省时按 prefers-reduced-motion 决定是否平滑。
   */
  const goTo = useCallback(
    (index: number, behavior?: ScrollBehavior) => {
      const target = wrapIndex(index, positions)
      startRef.current = target
      setStartIndex(target)

      const viewport = viewportRef.current
      if (viewport == null) return
      clearPending()

      const step = measureStep()
      const left = scrollLeftForIndex(target, step, maxScrollOf(viewport))
      if (Math.abs(viewport.scrollLeft - left) <= 1) return

      const timer = window.setTimeout(() => {
        // 隐藏窗口里平滑滚动可能推进不了、或被用户拖动打断：用挂钟兜底按实际位置收尾
        pendingRef.current = null
        const el = viewportRef.current
        if (el == null) return
        const actual = startIndexFromScroll(el.scrollLeft, measureStep(), positions)
        startRef.current = actual
        setStartIndex(actual)
      }, SCROLL_SETTLE_MS)
      pendingRef.current = { index: target, left, timer }

      viewport.scrollTo({
        left,
        behavior: behavior ?? (reducedMotion ? 'auto' : 'smooth'),
      })
    },
    [clearPending, measureStep, positions, reducedMotion],
  )

  /** 用户开始手动拖动/滚轮时立刻结束进行中的程序化滚动跟踪，
   *  否则 pending 期间（最长 SCROLL_SETTLE_MS）的点位/播报会落后于实际位置。 */
  const onUserScrollIntent = useCallback(() => {
    clearPending()
  }, [clearPending])

  /** 滚轮只在**横向**意图时算用户接管；纯纵向滚页不动 pending（否则圆点会闪）。 */
  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (isHorizontalWheelIntent(event.deltaX, event.deltaY, event.shiftKey)) {
        onUserScrollIntent()
      }
    },
    [onUserScrollIntent],
  )

  /** 原生滚动（手势拖动 / 平滑动画 / 浏览器 focus 滚动）→ 同步停靠下标 */
  const onScroll = useCallback(() => {
    const viewport = viewportRef.current
    if (viewport == null) return
    const step = measureStep()
    if (step <= 0) return

    const pending = pendingRef.current
    if (pending != null) {
      // 动画途中：中间位置不代表用户意图，等到达目标或超时
      if (Math.abs(viewport.scrollLeft - pending.left) > 1) return
      window.clearTimeout(pending.timer)
      pendingRef.current = null
    }

    const next = startIndexFromScroll(viewport.scrollLeft, step, positions)
    startRef.current = next
    setStartIndex((current) => (current === next ? current : next))
  }, [measureStep, positions])

  /** 焦点 reveal：卡片在视口外时把窗口滑过去（焦点绝不留在裁切区外） */
  const revealCard = useCallback(
    (index: number) => {
      const viewport = viewportRef.current
      if (viewport == null) return
      const step = measureStep()
      // 动画途中以「目标位」为基准，否则以实际滚动位置为准（浏览器 focus 滚动可能已发生）
      const current =
        pendingRef.current?.index ??
        (step > 0 ? startIndexFromScroll(viewport.scrollLeft, step, positions) : startRef.current)
      const target = revealStart(current, index, count)
      if (target !== current) goTo(target)
    },
    [count, goTo, measureStep, positions],
  )

  /** 窗口/容器尺寸变化后按新卡宽重新对齐到当前停靠位（滚动位置是像素，卡宽变了得重算） */
  const alignToStart = useCallback(
    (index: number) => {
      const viewport = viewportRef.current
      if (viewport == null) return
      clearPending()
      const step = measureStep()
      const left = scrollLeftForIndex(index, step, maxScrollOf(viewport))
      if (Math.abs(viewport.scrollLeft - left) > 1) {
        viewport.scrollTo({ left, behavior: 'auto' })
      }
    },
    [clearPending, measureStep],
  )

  // 停靠位数量变化（歌单数量变化）→ 收敛下标并重新对齐
  useEffect(() => {
    const next = wrapIndex(startRef.current, positions)
    startRef.current = next
    setStartIndex((current) => (current === next ? current : next))
    alignToStart(next)
  }, [alignToStart, positions])

  // 尺寸变化跟随：窗口缩放、侧栏收放、内容区宽度变化后都保持对齐
  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport == null || typeof window === 'undefined') return
    const realign = () => alignToStart(wrapIndex(startRef.current, positions))
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(realign) : null
    observer?.observe(viewport)
    window.addEventListener('resize', realign)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', realign)
    }
  }, [alignToStart, positions])

  // 卸载时清掉挂钟兜底，避免卸载后残留定时器在已销毁的节点上收尾
  useEffect(() => clearPending, [clearPending])

  // 自动播放：纯挂钟定时器；暂停 / 减少动画 / 一屏已全显时不挂计时器；卸载或依赖变化即清理
  useEffect(() => {
    if (!shouldAutoplay(count, hovered || focused, reducedMotion)) return
    const id = window.setInterval(() => {
      goTo(wrapIndex(startRef.current + 1, positions))
    }, FEATURED_AUTOPLAY_MS)
    return () => window.clearInterval(id)
  }, [count, focused, goTo, hovered, positions, reducedMotion])

  if (count === 0) return null
  // 一屏放不下的张数才出现翻页控件与圆点；键盘接管容器始终保留 —— 否则聚焦卡片
  // 按 Space 会被全局快捷键拦成播放/暂停。
  const showControls = count > FEATURED_VISIBLE

  /** 区域级键盘处理：左右切换、Home/End 跳首尾；Space/Enter/F 就地截停不上抛 */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Ctrl/Alt/Shift/Meta 组合键一律放行（Alt+←/→ = 路由后退/前进；Shift+F 等
    // 可能是用户自定义的全局快捷键）：既不 preventDefault 也不 stopPropagation，
    // 交给 NavHistoryControls / shortcuts.ts 等全局处理器。
    if (isModifierCombo(event)) return
    const key = event.key
    if (key === 'ArrowLeft') {
      event.preventDefault()
      event.stopPropagation()
      goTo(startRef.current - 1)
      return
    }
    if (key === 'ArrowRight') {
      event.preventDefault()
      event.stopPropagation()
      goTo(startRef.current + 1)
      return
    }
    if (key === 'Home') {
      event.preventDefault()
      event.stopPropagation()
      goTo(0)
      return
    }
    if (key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      goTo(positions - 1)
      return
    }
    // shortcuts.ts 的 window keydown 会把 button 上的 Space 拦成播放/暂停（并
    // preventDefault，按钮 click 就不再触发）、把 F 拦成专注模式切换 —— 轮播控件
    // 区域内这些键归控件自己：Space/Enter 激活按钮，F 留在控件上。
    if (key === ' ' || event.code === 'Space' || key === 'Enter' || key.toLowerCase() === 'f') {
      event.stopPropagation()
    }
  }

  const basis = slideBasisPercent(perView)
  const lastVisible = Math.min(start + FEATURED_VISIBLE, count)

  return (
    <div
      data-testid="featured-carousel"
      role="region"
      aria-roledescription="轮播"
      aria-label="今日精选歌单"
      className="group/carousel relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        // 焦点在轮播内部控件之间移动时 relatedTarget 仍在区域内，不算离开
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false)
        }
      }}
      onKeyDown={onKeyDown}
    >
      <div className="relative">
        {/* 滚动视口：原生横向滚动 + 停靠吸附；负外边距抵消卡内 gutter，卡片边缘与内容区对齐 */}
        <div className="-mx-2.5">
          <div
            ref={viewportRef}
            data-testid="featured-viewport"
            className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onScroll={onScroll}
            onPointerDown={onUserScrollIntent}
            onTouchStart={onUserScrollIntent}
            onWheel={onWheel}
          >
            {playlists.map((playlist, i) => (
              <div
                key={playlist.id}
                role="group"
                aria-roledescription="幻灯片"
                aria-label={`第 ${i + 1} 张，共 ${count} 张`}
                className="box-border shrink-0 grow-0 snap-start px-2.5"
                style={{ flex: `0 0 ${basis}%` }}
                onFocusCapture={() => revealCard(i)}
              >
                <FeaturedPlaylistCard playlist={playlist} />
              </div>
            ))}
          </div>
        </div>

        {/* 上一张 / 下一张：悬停轮播或焦点落在按钮上时显现（悬浮在视口左右缘） */}
        {showControls && (
          <div className="pointer-events-none absolute inset-y-0 left-2 flex items-center">
            <button
              type="button"
              data-testid="featured-prev"
              aria-label="上一张精选歌单"
              onClick={() => goTo(startRef.current - 1)}
              className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-card/85 text-primary opacity-0 shadow-md backdrop-blur-md transition-opacity duration-300 hover:bg-card-hover focus-visible:opacity-100 group-hover/carousel:opacity-100 motion-reduce:transition-none"
            >
              <ChevronLeft size={18} strokeWidth={2} />
            </button>
          </div>
        )}
        {showControls && (
          <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
            <button
              type="button"
              data-testid="featured-next"
              aria-label="下一张精选歌单"
              onClick={() => goTo(startRef.current + 1)}
              className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-card/85 text-primary opacity-0 shadow-md backdrop-blur-md transition-opacity duration-300 hover:bg-card-hover focus-visible:opacity-100 group-hover/carousel:opacity-100 motion-reduce:transition-none"
            >
              <ChevronRight size={18} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>

      {/* 圆点直跳（每个可停靠位置一个点；放在卡片下方，颜色走设计 token）。
          按钮本身是 `h-6 w-6` = 24×24 的命中区（含焦点环），内部 span 才是 6px 视觉小点 /
          20px 选中短线 —— 命中区与视觉尺寸解耦，点得准又不变丑。外边距取 3px：
          3 + (24-6)/2 = 12，视觉小点顶边恰好落在原来 mt-3 的位置（间距观感与改动前一致）。 */}
      {showControls && (
        <div className="mt-[3px] flex justify-center">
          {Array.from({ length: positions }, (_, i) => (
            <button
              key={i}
              type="button"
              data-testid={`featured-dot-${i}`}
              aria-label={`滑到第 ${i + 1} 屏精选歌单`}
              aria-current={i === start ? 'true' : undefined}
              onClick={() => goTo(i)}
              className="group/dot flex h-6 w-6 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <span
                aria-hidden="true"
                className={
                  'block h-1.5 rounded-full transition-all duration-300 motion-reduce:transition-none ' +
                  (i === start
                    ? 'w-5 bg-accent'
                    : 'w-1.5 bg-secondary/35 group-hover/dot:bg-secondary/60')
                }
              />
            </button>
          ))}
        </div>
      )}

      {/* 屏幕阅读器播报当前视窗（视觉隐藏）。aria-live 随暂停切换：自动轮播时 off ——
          否则朗读器每 6 秒被轮播打断一次；用户悬停/聚焦接管后手动切换才 polite 播报。 */}
      {showControls && (
        <div aria-live={hovered || focused ? 'polite' : 'off'} className="sr-only">
          {`第 ${start + 1} 至 ${lastVisible} 张，共 ${count} 张精选歌单`}
        </div>
      )}
    </div>
  )
}
