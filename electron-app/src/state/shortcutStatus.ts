/**
 * 全局热键注册结果 —— 主进程 `globalShortcut.register` 的失败清单。
 *
 * 主进程注册失败通常是「该组合已被其他程序/输入法占用」（Windows RegisterHotKey
 * 返回 false），此时热键不生效。失败清单在这里发布，设置页据此把对应行标红，
 * 用户可点键帽改成别的组合 —— 对应 Flutter 端 SystemHotKey 注册失败时的处理。
 *
 * 用 useSyncExternalStore 的最小发布订阅，避免把整棵应用树塞进 context。
 */

import { useSyncExternalStore } from 'react'

let failedActions: string[] = []
const listeners = new Set<() => void>()

/** 主进程返回值 `failed` = `${action} (${accelerator})`，这里解析出动作名 */
export function failedActionNames(failed: string[]): string[] {
  return failed.map((entry) => entry.split(' ')[0] ?? entry).filter((name) => name.length > 0)
}

export function publishShortcutRegistration(failed: string[]): void {
  const next = failedActionNames(failed)
  const same =
    next.length === failedActions.length && next.every((name, i) => name === failedActions[i])
  if (same) return
  failedActions = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): string[] {
  return failedActions
}

/** 注册失败的动作名列表（空数组 = 全部注册成功） */
export function useShortcutRegistrationFailures(): string[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/* ------------------------------------------------------------------ *
 * 录制期间的应用内快捷键屏蔽
 * ------------------------------------------------------------------ */

let captureActive = false

/**
 * 设置页正在录制新键位时为 true。
 *
 * 录制时要按下真实组合（空格 / F / 方向键），如果不屏蔽，`useShortcuts` 的
 * window keydown 会把这些键当成快捷键执行（例如录制里按空格同时暂停播放）。
 */
export function setShortcutCaptureActive(active: boolean): void {
  captureActive = active
}

export function isShortcutCaptureActive(): boolean {
  return captureActive
}
