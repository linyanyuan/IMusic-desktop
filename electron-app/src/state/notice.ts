/**
 * 全局轻量提示 —— 对应 Flutter 端各处的 `ScaffoldMessenger.showSnackBar(...)`
 * （例如未登录点收藏时的「请先登录」，Duration(seconds: 2)）。
 *
 * 与 shortcutStatus.ts / update.ts 同一套「模块级 store + useSyncExternalStore」
 * 最小发布订阅，避免把提示状态塞进 context。
 * 刻意不依赖 electron / DOM API，缺 window 时也能跑（供 node --test 直接测）。
 */

import { useSyncExternalStore } from 'react'

export interface Notice {
  id: number
  message: string
}

/** 默认停留时长 —— 与 Dart 端 SnackBar 的 `Duration(seconds: 2)` 一致 */
const DEFAULT_DURATION_MS = 2000

let notice: Notice | null = null
let nextId = 1
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function publish(next: Notice | null): void {
  notice = next
  for (const listener of listeners) listener()
}

function clearTimer(): void {
  if (timer == null) return
  clearTimeout(timer)
  timer = null
}

/**
 * 显示一条提示（durationMs 缺省 2000ms）。
 *
 * 重复调用会**替换**当前提示并**重置**计时器：连续点几次未登录的 ♥ 不会把提示
 * 排队堆叠，也不会被上一条的旧计时器提前清掉。`id` 自增，供 UI 侧做重挂载动画。
 */
export function showNotice(message: string, durationMs: number = DEFAULT_DURATION_MS): void {
  clearTimer()
  publish({ id: nextId++, message })
  timer = setTimeout(() => {
    timer = null
    publish(null)
  }, durationMs)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): Notice | null {
  return notice
}

/**
 * 当前提示；无提示时为 null。
 * 快照引用稳定：状态未变化时多次调用返回同一个对象（useSyncExternalStore 要求）。
 */
export function useNotice(): Notice | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
