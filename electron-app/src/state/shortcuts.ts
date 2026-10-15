/**
 * 渲染进程快捷键执行层 —— 对应 Flutter `desktop_shortcut_controller.dart`
 * 的应用内 `Shortcuts`/`Actions` 部分。
 *
 * 分工：
 * - inApp 作用域（Space 播放/暂停、F 专注模式）：本文件用 window keydown 处理，
 *   窗口聚焦时才生效，且输入框聚焦时不拦截。
 * - global 作用域（Ctrl+Alt+P/←/→/↑/↓/M/D）：渲染进程把 accelerator 表推给主进程，
 *   由主进程 globalShortcut 注册后经 `imusic:shortcut` 回传动作名，因此窗口未聚焦
 *   时同样生效（等价 Flutter 的桌面端全局热键）。
 */

import { useEffect, useRef } from 'react'
import { usePlayer } from '../contexts/PlayerContext'
import { useSettings } from './hooks'
import { useRoute } from './route'
import {
  domKeyFor,
  globalAccelerators,
  shortcutDefinitions,
  type KeyboardShortcut,
  type ShortcutAction,
  type ShortcutSettings,
} from '../services/shortcutSettings'
import { isShortcutCaptureActive, publishShortcutRegistration } from './shortcutStatus'

/** 音量步长，对齐 Flutter playback_commands.dart 的 playbackVolumeStep */
export const VOLUME_STEP = 0.08

/** 事件是否命中该键位（修饰键需完全一致，避免 Alt 漏判） */
export function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut | null): boolean {
  if (shortcut == null) return false
  if (event.ctrlKey !== shortcut.control) return false
  if (event.altKey !== shortcut.alt) return false
  if (event.shiftKey !== shortcut.shift) return false
  if (event.metaKey !== shortcut.meta) return false
  const expected = domKeyFor(shortcut.key)
  if (shortcut.key === 'space') return event.key === ' ' || event.code === 'Space'
  return event.key.toLowerCase() === expected.toLowerCase()
}

/** 焦点在可编辑元素里时不触发快捷键（否则空格会变成输空格） */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return target.isContentEditable
}

export function useShortcuts(): void {
  const player = usePlayer()
  const route = useRoute()
  const settings = useSettings()

  const runRef = useRef<(action: ShortcutAction) => void>(() => {})
  runRef.current = (action: ShortcutAction) => {
    switch (action) {
      case 'playPauseInApp':
      case 'playPauseGlobal':
        player.togglePlay()
        break
      case 'previousTrack':
        player.prev()
        break
      case 'nextTrack':
        player.next()
        break
      case 'volumeUp':
        player.stepVolume(VOLUME_STEP)
        break
      case 'volumeDown':
        player.stepVolume(-VOLUME_STEP)
        break
      case 'mute':
        player.toggleMute()
        break
      case 'toggleDesktopLyrics':
        // 独立桌面歌词窗口（对应 Flutter 的 Ctrl+Alt+D 桌面歌词窗）
        void window.imusicAPI?.lyricsToggle().catch(() => {})
        break
      case 'toggleFocusMode':
        route.toggleFocus()
        break
    }
  }

  const settingsRef = useRef<ShortcutSettings>(settings.shortcutSettings)
  settingsRef.current = settings.shortcutSettings

  // ---- 应用内快捷键 ----
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      // 设置页正在录制新键位：此期间不执行任何应用内快捷键
      if (isShortcutCaptureActive()) return
      if (isEditableTarget(event.target)) return
      const active = settingsRef.current
      for (const def of shortcutDefinitions) {
        if (def.scope !== 'inApp') continue
        // 用 shortcutFor 的原值：null 表示用户显式解绑，不能回落到默认值
        // （fromJson 会填满每个动作，所以解绑后这里就是 null）
        const binding = active.shortcutFor(def.action)
        if (binding == null) continue
        if (!matchesShortcut(event, binding)) continue
        event.preventDefault()
        runRef.current(def.action)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ---- 全局热键：推给主进程注册，并接收回传动作 ----
  const shortcutSettings = settings.shortcutSettings
  const globalEnabled = shortcutSettings.globalHotkeysEnabled
  useEffect(() => {
    const api = window.imusicAPI
    if (api?.shortcutsRegister == null) return
    const accelerators = globalEnabled ? globalAccelerators(shortcutSettings) : null
    void api
      .shortcutsRegister(accelerators)
      .then((result: { failed?: string[] } | null) => {
        const failed = result?.failed ?? []
        publishShortcutRegistration(failed)
        if (failed.length > 0) {
          console.warn('[Shortcuts] 全局热键注册失败（可能被其他程序占用）:', failed)
        }
      })
      .catch((e: unknown) => console.warn('[Shortcuts] 全局热键注册异常:', e))
  }, [globalEnabled, shortcutSettings])

  useEffect(() => {
    const api = window.imusicAPI
    if (api?.onShortcut == null) return
    return api.onShortcut((action: string) => {
      // 设置页录制中不执行：已注册的全局热键在录制时也会经这条路径回传，
      // 否则录一个已绑定键会连带触发该动作。
      if (isShortcutCaptureActive()) return
      const name = action as ShortcutAction
      if (shortcutDefinitions.some((d) => d.action === name)) runRef.current(name)
    })
  }, [])
}
