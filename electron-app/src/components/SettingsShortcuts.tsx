/**
 * 快捷键设置区 —— 1:1 移植 lib/desktop/widgets/settings_shortcuts_section.dart。
 *
 * 行为对齐 Dart 版：
 * - 顶部：启用全局热键开关 + 「恢复默认」
 * - 两张分组表：播放控制 / 窗口与歌词
 * - 点键帽（或铅笔）进入录制：Esc 取消、Backspace/Delete 解除绑定、其余键位即时保存
 * - 同作用域内键位重复时显示「已与 X 冲突」
 * - 全局热键被其他程序占用（主进程注册失败）时显示红色提示，可改绑其他组合
 */

import { useEffect, useRef, useState } from 'react'
import {
  Crosshair,
  Mic2,
  Pencil,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useSettings } from '../state/hooks'
import { useShortcutRegistrationFailures, setShortcutCaptureActive } from '../state/shortcutStatus'
import {
  definitionFor,
  hasModifier,
  ShortcutSettings,
  shortcutDisplayLabel,
  shortcutFromKeyboardEvent,
  type ShortcutAction,
} from '../services/shortcutSettings'

const PLAYBACK_ACTIONS: ShortcutAction[] = [
  'playPauseInApp',
  'playPauseGlobal',
  'previousTrack',
  'nextTrack',
  'volumeUp',
  'volumeDown',
  'mute',
]

const WINDOW_ACTIONS: ShortcutAction[] = ['toggleDesktopLyrics', 'toggleFocusMode']

/** 键帽的 3 种状态样式（录制 / 未绑定 / 已绑定）——抽成函数避免嵌套三元 */
function bindingButtonClass(isRecording: boolean, bound: boolean): string {
  if (isRecording) return 'border-[#FA233B] bg-[#FA233B]/10 text-[#FA233B]'
  if (!bound) return 'border-dashed border-[#E5E5EA] bg-white text-[#86868B]'
  return 'border-[#E5E5EA] bg-white text-[#1D1D1F] hover:border-[#FA233B]/50'
}

function ActionIcon({ action }: { action: ShortcutAction }) {
  const size = 15
  switch (action) {
    case 'playPauseInApp':
    case 'playPauseGlobal':
      return <Play size={size} strokeWidth={1.9} />
    case 'previousTrack':
      return <SkipBack size={size} strokeWidth={1.9} />
    case 'nextTrack':
      return <SkipForward size={size} strokeWidth={1.9} />
    case 'volumeUp':
      return <Volume2 size={size} strokeWidth={1.9} />
    case 'volumeDown':
      return <Volume1 size={size} strokeWidth={1.9} />
    case 'mute':
      return <VolumeX size={size} strokeWidth={1.9} />
    case 'toggleDesktopLyrics':
      return <Mic2 size={size} strokeWidth={1.9} />
    case 'toggleFocusMode':
      return <Crosshair size={size} strokeWidth={1.9} />
  }
}

export function SettingsShortcuts() {
  const settings = useSettings()
  const failures = useShortcutRegistrationFailures()
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  const snapshot = settings.shortcutSettings
  const value = snapshot

  // 录制期间挂 window keydown（capture 阶段，抢在应用内快捷键之前）
  const recordingRef = useRef<ShortcutAction | null>(null)
  recordingRef.current = recording
  const settingsRef = useRef<ShortcutSettings>(value)
  settingsRef.current = value

  useEffect(() => {
    setShortcutCaptureActive(recording != null)
    if (recording == null) return
    const onKeyDown = (event: KeyboardEvent) => {
      const action = recordingRef.current
      if (action == null) return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(null)
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        settingsRef.current = settingsRef.current.copyWithShortcut(action, null)
        settings.setShortcutSettings(settingsRef.current)
        setRecording(null)
        return
      }
      // 只按修饰键不算完成，继续等主键
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
      const shortcut = shortcutFromKeyboardEvent(event)
      if (shortcut == null) return
      // 全局动作必须带修饰键：无修饰单键会作为 OS 级热键把 Space/F 从系统抢走，
      // 这类录制直接忽略，继续保持录制态让用户重按。
      if (definitionFor(action).scope === 'global' && !hasModifier(shortcut)) return
      settingsRef.current = settingsRef.current.copyWithShortcut(action, shortcut)
      settings.setShortcutSettings(settingsRef.current)
      setRecording(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recording, settings])

  useEffect(() => () => setShortcutCaptureActive(false), [])

  const renderGroup = (title: string, actions: ShortcutAction[]) => (
    <div className="overflow-hidden rounded-xl border border-[#E5E5EA] bg-white/60">
      <div className="border-b border-[#E5E5EA] px-3.5 py-2 text-[11px] font-bold tracking-wide text-[#86868B]">
        {title}
      </div>
      <ul className="divide-y divide-[#E5E5EA]">
        {actions.map((action) => {
          const def = definitionFor(action)
          const binding = value.shortcutFor(action)
          const conflicts = value.conflictingActions(action)
          const failed = failures.includes(action)
          const isRecording = recording === action
          return (
            <li key={action} className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#F2F2F7] text-[#86868B]">
                <ActionIcon action={action} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[12.5px] font-medium text-[#1D1D1F]">
                  {def.title}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10.5px] font-normal ${
                      def.scope === 'global'
                        ? 'bg-[#FA233B]/10 text-[#FA233B]'
                        : 'text-[#86868B] ring-1 ring-[#E5E5EA]'
                    }`}
                  >
                    {def.scope === 'inApp' ? '应用内' : '全局'}
                  </span>
                </div>
                <div className="truncate text-[11.5px] text-[#86868B]">{def.description}</div>
                {conflicts.length > 0 && (
                  <div className="mt-0.5 text-[11.5px] text-red-500">
                    已与 {conflicts.map((a) => definitionFor(a).title).join('、')} 冲突
                  </div>
                )}
                {failed && (
                  <div className="mt-0.5 text-[11.5px] text-red-500" data-shortcut-unavailable={action}>
                    该组合已被其他程序占用，未生效
                  </div>
                )}
              </div>
              <button
                type="button"
                data-shortcut-action={action}
                aria-label={`编辑快捷键 ${def.title}`}
                onClick={() => setRecording(action)}
                className={`w-[132px] shrink-0 rounded-md border px-3 py-1 text-center font-mono text-[11px] shadow-sm transition-colors ${bindingButtonClass(
                  isRecording,
                  binding != null,
                )}`}
              >
                {isRecording ? '按下新的快捷键' : binding != null ? shortcutDisplayLabel(binding) : '未设置'}
              </button>
              <button
                type="button"
                aria-label={`编辑快捷键 ${def.title}`}
                onClick={() => setRecording(action)}
                className="shrink-0 rounded-md p-1 text-[#86868B] hover:bg-[#F2F2F7] hover:text-[#1D1D1F]"
              >
                <Pencil size={14} strokeWidth={1.75} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-[12.5px] text-[#1D1D1F]">
          <input
            type="checkbox"
            data-testid="shortcut-global-toggle"
            aria-label="启用全局热键"
            checked={value.globalHotkeysEnabled}
            onChange={(e) => settings.setGlobalHotkeysEnabled(e.target.checked)}
            className="h-4 w-4 accent-[#FA233B]"
          />
          启用全局热键
        </label>
        <button
          type="button"
          data-testid="shortcut-reset"
          onClick={() => {
            setRecording(null)
            settings.setShortcutSettings(ShortcutSettings.defaults())
          }}
          className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-[#86868B] hover:bg-[#FA233B]/8 hover:text-[#1D1D1F]"
        >
          <RotateCcw size={14} strokeWidth={1.75} />
          恢复默认
        </button>
      </div>
      {renderGroup('播放控制', PLAYBACK_ACTIONS)}
      {renderGroup('窗口与歌词', WINDOW_ACTIONS)}
      <p className="text-[11.5px] text-[#86868B]">
        点键帽进入录制：Esc 取消、Backspace 解除绑定。全局热键被其他程序占用时不会生效，可改绑
        Ctrl + Alt + Shift + 键 等组合（部分系统会占用 Ctrl + Alt + 字母）。
      </p>
      <p className="text-[11.5px] text-[#86868B]">
        「显示/隐藏桌面歌词」切换 Electron 的独立桌面歌词窗口（`electron/lyricsWindow.ts`，全局热键
        Ctrl + Alt + D）。
      </p>
    </div>
  )
}
