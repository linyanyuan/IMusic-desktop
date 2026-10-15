/**
 * 全局热键注册 —— 对应 Flutter `desktop_shortcut_controller.dart` + Rust 侧的
 * 系统级热键注册部分。
 *
 * 键位来自渲染进程（设置存在 localStorage），渲染进程推 accelerator 表过来，
 * 主进程只负责注册/注销，并在触发时把动作名回传给所有窗口；真正执行动作的仍是
 * 渲染进程（播放控制、专注模式切换等都在 PlayerContext/RouteContext 里）。
 */

import { BrowserWindow, globalShortcut, ipcMain } from 'electron'

type AcceleratorMap = Record<string, string>

let current: AcceleratorMap = {}

function unregisterOwned(): void {
  for (const accelerator of Object.values(current)) {
    globalShortcut.unregister(accelerator)
  }
  current = {}
}

/** 用新表替换旧表；再传一次相同表现在不会自行冲突（旧表先注销） */
export function applyGlobalShortcuts(accelerators: AcceleratorMap | null): { failed: string[] } {
  unregisterOwned()
  if (accelerators == null) return { failed: [] }

  const failed: string[] = []
  const next: AcceleratorMap = {}
  for (const [action, accelerator] of Object.entries(accelerators)) {
    if (accelerator == null || accelerator === '') continue
    let ok = false
    try {
      ok = globalShortcut.register(accelerator, () => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('imusic:shortcut', action)
        }
      })
    } catch {
      ok = false
    }
    if (ok) next[action] = accelerator
    else failed.push(`${action} (${accelerator})`)
  }
  current = next
  return { failed }
}

export function registerShortcutIpc(): void {
  ipcMain.handle('imusic:shortcutsRegister', (_event, accelerators: AcceleratorMap | null) =>
    applyGlobalShortcuts(accelerators ?? null),
  )
}

export function unregisterGlobalShortcuts(): void {
  unregisterOwned()
}
