/**
 * 更新检查状态机 —— 对应 Flutter 端 lib/desktop/update/update_providers.dart
 * 的 UpdateCheckState + UpdateActions。
 *
 * 真正的网络/落盘/拉起安装器都在主进程（electron/update.ts），这里只保留状态与
 * 动作，用模块级 store + useSyncExternalStore 发布（与 shortcutStatus.ts 同一套
 * 最小发布订阅），这样设置页的「检查更新」和全局更新弹窗读的是同一份状态 ——
 * 对应 Dart 端两个界面 watch 同一个 Riverpod provider。
 */

import { useSyncExternalStore } from 'react'

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; manifest: UpdateManifest }
  | { kind: 'downloading'; manifest: UpdateManifest; received: number; total: number | null }
  | { kind: 'downloaded'; manifest: UpdateManifest; filePath: string }
  | { kind: 'upToDate' }
  | { kind: 'error'; message: string }

let state: UpdateState = { kind: 'idle' }
let currentVersion: string | null = null
const listeners = new Set<() => void>()

function publish(next: UpdateState): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): UpdateState {
  return state
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function useAppVersion(): string | null {
  return useSyncExternalStore(subscribe, () => currentVersion, () => currentVersion)
}

export function currentUpdateState(): UpdateState {
  return state
}

function api(): Window['imusicAPI'] | undefined {
  return window.imusicAPI
}

/** 读取当前版本（启动时调一次即可） */
export async function loadAppVersion(): Promise<string | null> {
  const bridge = api()
  if (bridge?.updateInfo == null) return null
  try {
    const info = await bridge.updateInfo()
    currentVersion = info.currentVersion
    for (const listener of listeners) listener()
    return info.currentVersion
  } catch {
    return null
  }
}

/** 下载进度：来自主进程广播 */
let progressSubscribed = false
function ensureProgressSubscription(): void {
  if (progressSubscribed) return
  const bridge = api()
  if (bridge?.onUpdateProgress == null) return
  progressSubscribed = true
  bridge.onUpdateProgress((progress) => {
    // 只有正在下载的这一次任务才消费进度（用户取消后到达的尾包要丢弃）
    if (state.kind !== 'downloading') return
    publish({ ...state, received: progress.received, total: progress.total })
  })
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}

/**
 * 检查更新。
 * manual=true 时跳过 24h 节流，并把「已是最新」「检查失败」也反映到状态上
 * （设置页要显示这两种结果）；manual=false 的静默检查失败/无更新都保持 idle。
 */
export async function checkForUpdate(manual: boolean): Promise<void> {
  const bridge = api()
  if (bridge?.updateCheck == null) return
  ensureProgressSubscription()
  if (state.kind === 'checking' || state.kind === 'downloading') return

  publish({ kind: 'checking' })
  try {
    const result = await bridge.updateCheck(manual)
    if (result.available && result.remote != null) {
      publish({ kind: 'available', manifest: result.remote })
      return
    }
    // 拉不到清单 ≠ 已是最新：私有仓库/断网时清单地址会 404，若不区分就会把
    // 「根本没检查到」谎报成「已是最新」（真实踩坑：2.3.5 检测不到 2.3.6）。
    if (manual && result.error != null && result.error !== '') {
      publish({ kind: 'error', message: result.error })
      return
    }
    publish(manual ? { kind: 'upToDate' } : { kind: 'idle' })
  } catch (error) {
    publish(manual ? { kind: 'error', message: errorMessage(error) } : { kind: 'idle' })
  }
}

/** 开始下载（仅在 available 状态有意义） */
export async function downloadUpdate(): Promise<void> {
  const bridge = api()
  if (bridge?.updateDownload == null) return
  const current = state
  if (current.kind !== 'available') return

  const manifest = current.manifest
  publish({ kind: 'downloading', manifest, received: 0, total: null })
  try {
    const { filePath } = await bridge.updateDownload(manifest)
    publish({ kind: 'downloaded', manifest, filePath })
  } catch (error) {
    // 用户点「取消」触发的 abort 不应该显示成错误
    if (state.kind !== 'downloading') return
    publish({ kind: 'error', message: errorMessage(error) })
  }
}

/** 关掉弹窗：下载中则同时取消下载 */
export function dismissUpdate(): void {
  const current = state
  if (current.kind === 'downloading') {
    void api()?.updateCancel?.()
  }
  publish({ kind: 'idle' })
}

/** 拉起安装器并退出（主进程成功后进程即退出，这里通常不会走到 resolve） */
export async function installAndQuit(): Promise<void> {
  const bridge = api()
  const current = state
  if (bridge?.updateInstall == null || current.kind !== 'downloaded') return
  try {
    await bridge.updateInstall(current.filePath)
  } catch (error) {
    publish({ kind: 'error', message: errorMessage(error) })
  }
}
