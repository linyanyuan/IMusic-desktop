/**
 * 快捷键设置 —— 1:1 移植自 lib/services/shortcut_settings.dart。
 * localStorage key 与 Dart SharedPreferences key 一致（settings_shortcuts），
 * JSON 结构（{ globalHotkeysEnabled, shortcuts: { action: {control,alt,shift,meta,key} } }）
 * 也与 Dart 端 toJson/fromJson 一致。
 */

export type ShortcutScope = 'inApp' | 'global'

export type ShortcutKey =
  | 'space'
  | 'f'
  | 'p'
  | 'm'
  | 'd'
  | 'arrowLeft'
  | 'arrowRight'
  | 'arrowUp'
  | 'arrowDown'

export type ShortcutAction =
  | 'playPauseInApp'
  | 'playPauseGlobal'
  | 'previousTrack'
  | 'nextTrack'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'toggleDesktopLyrics'
  | 'toggleFocusMode'

export interface KeyboardShortcut {
  control: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: ShortcutKey
}

export interface ShortcutDefinition {
  action: ShortcutAction
  title: string
  description: string
  scope: ShortcutScope
  defaultShortcut: KeyboardShortcut
}

const SHORTCUT_KEYS: ShortcutKey[] = [
  'space',
  'f',
  'p',
  'm',
  'd',
  'arrowLeft',
  'arrowRight',
  'arrowUp',
  'arrowDown',
]

const ACTION_NAMES: ShortcutAction[] = [
  'playPauseInApp',
  'playPauseGlobal',
  'previousTrack',
  'nextTrack',
  'volumeUp',
  'volumeDown',
  'mute',
  'toggleDesktopLyrics',
  'toggleFocusMode',
]

/** 键名 → 按键标签（Dart `_keyLabel`） */
export function keyLabel(key: ShortcutKey): string {
  switch (key) {
    case 'space':
      return 'Space'
    case 'f':
      return 'F'
    case 'p':
      return 'P'
    case 'm':
      return 'M'
    case 'd':
      return 'D'
    case 'arrowLeft':
      return 'Left'
    case 'arrowRight':
      return 'Right'
    case 'arrowUp':
      return 'Up'
    case 'arrowDown':
      return 'Down'
  }
}

/** 键名 → KeyboardEvent.key 的期望值 */
export function domKeyFor(key: ShortcutKey): string {
  switch (key) {
    case 'space':
      return ' '
    case 'f':
    case 'p':
    case 'm':
    case 'd':
      return key
    case 'arrowLeft':
      return 'ArrowLeft'
    case 'arrowRight':
      return 'ArrowRight'
    case 'arrowUp':
      return 'ArrowUp'
    case 'arrowDown':
      return 'ArrowDown'
  }
}

export function shortcutDisplayLabel(s: KeyboardShortcut): string {
  const parts: string[] = []
  if (s.control) parts.push('Ctrl')
  if (s.alt) parts.push('Alt')
  if (s.shift) parts.push('Shift')
  if (s.meta) parts.push('Win')
  parts.push(keyLabel(s.key))
  return parts.join(' + ')
}

/** 快捷键 → Electron globalShortcut accelerator（如 Ctrl+Alt+P） */
export function electronAccelerator(s: KeyboardShortcut): string {
  const parts: string[] = []
  if (s.control) parts.push('CommandOrControl')
  if (s.alt) parts.push('Alt')
  if (s.shift) parts.push('Shift')
  if (s.meta) parts.push('Super')
  // 键名文案与快捷键表共用 keyLabel，避免两份 map 分叉
  parts.push(keyLabel(s.key))
  return parts.join('+')
}

/** 是否会抢占 OS 级的无修饰单键（globalShortcut 不接受这种绑定） */
export function hasModifier(s: KeyboardShortcut): boolean {
  return s.control || s.alt || s.shift || s.meta
}

export function keyboardShortcutFromJson(json: unknown): KeyboardShortcut {
  const m = (json ?? {}) as Record<string, unknown>
  const key = SHORTCUT_KEYS.find((k) => k === m['key'])
  return {
    control: m['control'] === true,
    alt: m['alt'] === true,
    shift: m['shift'] === true,
    meta: m['meta'] === true,
    key: key ?? 'space',
  }
}

/** 键名 → KeyboardEvent.key/code（1:1 移植 Dart `shortcutKeyFromLogicalKey`） */
export function shortcutKeyFromDom(event: KeyboardEvent): ShortcutKey | null {
  if (event.key === ' ' || event.code === 'Space') return 'space'
  switch (event.code) {
    case 'KeyF':
      return 'f'
    case 'KeyP':
      return 'p'
    case 'KeyM':
      return 'm'
    case 'KeyD':
      return 'd'
    case 'ArrowLeft':
      return 'arrowLeft'
    case 'ArrowRight':
      return 'arrowRight'
    case 'ArrowUp':
      return 'arrowUp'
    case 'ArrowDown':
      return 'arrowDown'
    default:
      break
  }
  // 无 code 的合成事件退化为 key 匹配（Dart 侧用的是 logicalKey）
  switch (event.key.toLowerCase()) {
    case 'f':
      return 'f'
    case 'p':
      return 'p'
    case 'm':
      return 'm'
    case 'd':
      return 'd'
    case 'arrowleft':
      return 'arrowLeft'
    case 'arrowright':
      return 'arrowRight'
    case 'arrowup':
      return 'arrowUp'
    case 'arrowdown':
      return 'arrowDown'
    default:
      return null
  }
}

/** 录制用：把一次按键事件转成快捷键（1:1 移植 Dart `shortcutFromKeyEvent`） */
export function shortcutFromKeyboardEvent(event: KeyboardEvent): KeyboardShortcut | null {
  const key = shortcutKeyFromDom(event)
  if (key == null) return null
  return {
    control: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    key,
  }
}

export function sameShortcut(a: KeyboardShortcut | null, b: KeyboardShortcut | null): boolean {
  if (a == null || b == null) return a === b
  return (
    a.control === b.control &&
    a.alt === b.alt &&
    a.shift === b.shift &&
    a.meta === b.meta &&
    a.key === b.key
  )
}

/** 动作定义（Dart `shortcutDefinitions`，标题/描述文案一致） */
export const shortcutDefinitions: ShortcutDefinition[] = [
  {
    action: 'playPauseInApp',
    title: '播放/暂停',
    description: '在应用窗口内控制当前歌曲',
    scope: 'inApp',
    defaultShortcut: { control: false, alt: false, shift: false, meta: false, key: 'space' },
  },
  {
    action: 'playPauseGlobal',
    title: '播放/暂停',
    description: '窗口未聚焦时也可控制当前歌曲',
    scope: 'global',
    defaultShortcut: { control: true, alt: true, shift: false, meta: false, key: 'p' },
  },
  {
    action: 'previousTrack',
    title: '上一首',
    description: '播放队列中的上一首歌曲',
    scope: 'global',
    defaultShortcut: { control: true, alt: true, shift: false, meta: false, key: 'arrowLeft' },
  },
  {
    action: 'nextTrack',
    title: '下一首',
    description: '播放队列中的下一首歌曲',
    scope: 'global',
    defaultShortcut: { control: true, alt: true, shift: false, meta: false, key: 'arrowRight' },
  },
  {
    action: 'volumeUp',
    title: '音量增加',
    description: '提高播放器音量',
    scope: 'global',
    defaultShortcut: { control: true, alt: true, shift: false, meta: false, key: 'arrowUp' },
  },
  {
    action: 'volumeDown',
    title: '音量降低',
    description: '降低播放器音量',
    scope: 'global',
    defaultShortcut: { control: true, alt: true, shift: false, meta: false, key: 'arrowDown' },
  },
  {
    action: 'mute',
    title: '静音/取消静音',
    description: '快速切换播放器静音状态',
    scope: 'global',
    defaultShortcut: { control: true, alt: true, shift: false, meta: false, key: 'm' },
  },
  {
    action: 'toggleDesktopLyrics',
    title: '显示/隐藏桌面歌词',
    description: '切换独立桌面歌词窗口',
    scope: 'global',
    defaultShortcut: { control: true, alt: true, shift: false, meta: false, key: 'd' },
  },
  {
    action: 'toggleFocusMode',
    title: '进入/退出专注模式',
    description: '在主界面和专注聆听之间切换',
    scope: 'inApp',
    defaultShortcut: { control: false, alt: false, shift: false, meta: false, key: 'f' },
  },
]

export function defaultShortcutBindings(): Record<ShortcutAction, KeyboardShortcut> {
  const out = {} as Record<ShortcutAction, KeyboardShortcut>
  for (const d of shortcutDefinitions) out[d.action] = d.defaultShortcut
  return out
}

export function definitionFor(action: ShortcutAction): ShortcutDefinition {
  const found = shortcutDefinitions.find((d) => d.action === action)
  if (found == null) throw new Error(`unknown shortcut action: ${action}`)
  return found
}

export interface ShortcutSettingsJson {
  globalHotkeysEnabled: boolean
  shortcuts: Partial<Record<ShortcutAction, KeyboardShortcut | null>>
}

export class ShortcutSettings {
  readonly globalHotkeysEnabled: boolean
  readonly shortcuts: Record<ShortcutAction, KeyboardShortcut | null>

  constructor(globalHotkeysEnabled: boolean, shortcuts: Record<ShortcutAction, KeyboardShortcut | null>) {
    this.globalHotkeysEnabled = globalHotkeysEnabled
    this.shortcuts = shortcuts
  }

  static defaults(): ShortcutSettings {
    return new ShortcutSettings(true, defaultShortcutBindings())
  }

  static fromJson(json: unknown): ShortcutSettings {
    const m = (json ?? {}) as Record<string, unknown>
    const shortcuts = { ...defaultShortcutBindings() } as Record<
      ShortcutAction,
      KeyboardShortcut | null
    >
    const raw = m['shortcuts']
    if (raw != null && typeof raw === 'object') {
      for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
        const action = ACTION_NAMES.find((a) => a === name)
        if (action == null) continue
        shortcuts[action] =
          value != null && typeof value === 'object' ? keyboardShortcutFromJson(value) : null
      }
    }
    return new ShortcutSettings(m['globalHotkeysEnabled'] !== false, shortcuts)
  }

  shortcutFor(action: ShortcutAction): KeyboardShortcut | null {
    return this.shortcuts[action] ?? null
  }

  copyWith(patch: { globalHotkeysEnabled?: boolean }): ShortcutSettings {
    return new ShortcutSettings(
      patch.globalHotkeysEnabled ?? this.globalHotkeysEnabled,
      { ...this.shortcuts },
    )
  }

  copyWithShortcut(action: ShortcutAction, shortcut: KeyboardShortcut | null): ShortcutSettings {
    return new ShortcutSettings(this.globalHotkeysEnabled, { ...this.shortcuts, [action]: shortcut })
  }

  conflictingActions(action: ShortcutAction): ShortcutAction[] {
    const shortcut = this.shortcutFor(action)
    const definition = definitionFor(action)
    if (shortcut == null) return []
    return shortcutDefinitions
      .filter((item) => item.action !== action && item.scope === definition.scope)
      .filter((item) => sameShortcut(this.shortcutFor(item.action), shortcut))
      .map((item) => item.action)
  }

  toJson(): ShortcutSettingsJson {
    const shortcuts: Partial<Record<ShortcutAction, KeyboardShortcut | null>> = {}
    for (const [action, shortcut] of Object.entries(this.shortcuts)) {
      shortcuts[action as ShortcutAction] = shortcut
    }
    return { globalHotkeysEnabled: this.globalHotkeysEnabled, shortcuts }
  }
}

/** 全局热键注册表（主进程 globalShortcut 用）：动作 → accelerator */
export function globalAccelerators(
  settings: ShortcutSettings,
): Partial<Record<ShortcutAction, string>> {
  const out: Partial<Record<ShortcutAction, string>> = {}
  for (const def of shortcutDefinitions) {
    // 只注册「全局」作用域的动作。应用内快捷键（Space / F 这类无修饰单键）
    // 绝不能交给主进程的 globalShortcut：它是 OS 级注册，会把无修饰键
    // 从整个系统抢走（运行期间其他程序打不出空格 / f），且与渲染进程的
    // keydown 处理重复触发。
    if (def.scope !== 'global') continue
    const s = settings.shortcutFor(def.action)
    if (s == null) continue
    // 双重保险：用户把全局动作录成无修饰单键时也不进 OS 级注册（否则会抢占系统按键）。
    if (!hasModifier(s)) continue
    out[def.action] = electronAccelerator(s)
  }
  return out
}
