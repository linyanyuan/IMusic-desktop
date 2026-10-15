/**
 * 视图前进/后退历史 —— 纯函数核（不依赖 React，便于单测）。
 *
 * 语义与浏览器一致：
 * - 新导航：current 入后退栈，前进栈清空
 * - 后退：后退栈顶出栈成为 current，原 current 压入前进栈
 * - 前进：对称
 * - 与 current 相同的目标不产生历史条目（避免重复点击同一导航项刷出重复栈）
 *
 * 专注模式（DeskRoute.Focus）不在历史里：它是覆盖式沉浸模式，
 * 进出由 toggleFocus 自己记来源，不污染前进/后退链。
 */

export interface NavHistory<T> {
  /** 后退栈（栈顶 = 上一个页面） */
  back: T[]
  /** 前进栈（栈顶 = 下一个页面；按栈顶在 index 0 存） */
  forward: T[]
  current: T
}

export function emptyHistory<T>(initial: T): NavHistory<T> {
  return { back: [], forward: [], current: initial }
}

export function canGoBack<T>(h: NavHistory<T>): boolean {
  return h.back.length > 0
}

export function canGoForward<T>(h: NavHistory<T>): boolean {
  return h.forward.length > 0
}

export function navigateTo<T>(
  h: NavHistory<T>,
  next: T,
  equals: (a: T, b: T) => boolean,
): NavHistory<T> {
  if (equals(h.current, next)) return h
  return { back: [...h.back, h.current], forward: [], current: next }
}

/** 后退一步；无可退时返回 null（调用方保持原状） */
export function goBack<T>(h: NavHistory<T>): NavHistory<T> | null {
  if (h.back.length === 0) return null
  const prev = h.back[h.back.length - 1] as T
  return {
    back: h.back.slice(0, -1),
    forward: [h.current, ...h.forward],
    current: prev,
  }
}

/** 前进一步；无可进时返回 null */
export function goForward<T>(h: NavHistory<T>): NavHistory<T> | null {
  if (h.forward.length === 0) return null
  const [next, ...rest] = h.forward
  return { back: [...h.back, h.current], forward: rest, current: next as T }
}

/** 不改历史链地替换 current（专注模式进出用） */
export function replaceCurrent<T>(h: NavHistory<T>, next: T): NavHistory<T> {
  return { ...h, current: next }
}
