/**
 * 应用设置 —— 移植自 lib/services/app_settings.dart。
 * SharedPreferences 等价物为 localStorage（经 storage 适配层，可注入内存实现），
 * key 名字符串与 Dart 端完全一致。
 *
 * 语义取舍：
 * - shortcutSettings（快捷键映射）与 Dart 端结构、storage key 完全一致（settings_shortcuts）。
 * - cacheDirectory 的"默认路径解析"依赖 path_provider，Electron 端由主进程决定，
 *   这里只保留设置值的读写。
 * - ChKSz API Key 改成「Key 池」：设置页可配置多条 key（settings_chksz_api_keys，
 *   JSON 数组字符串），运行时由 ChkszKeyPool 轮询分摊并对失效 key 做冷却切换。
 *   旧版单 key 设置（settings_chksz_api_key）在首次读取时自动迁移进池。构建期注入
 *   （VITE_CHKSZ_API_KEY）**不进池**，只在池为空时由 client 兜底，与 Dart 端
 *   `--dart-define=CHKSZ_API_KEY` 的兜底角色一致。
 */

import { createDefaultStorage, type KeyValueStorage } from './storage'
import { ShortcutSettings } from './shortcutSettings'
import { normalizeKeyList } from './chkszKeyPool'

/** 构建期注入的兜底 key；仓库内不硬编码真实 key。导出供 runtime 在 Key 池为空时兜底 */
// SAFETY: import.meta.env 的类型由 Vite 在构建期注入，独立 tsc 类型检查时没有
// vite/client 声明，这里收窄为可选 env 形状；env 缺失时 ?? '' 兜底，不会解引用 undefined。
export const BUILD_TIME_CHKSZ_API_KEY: string =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_CHKSZ_API_KEY ?? ''

export interface AppSettingsSnapshot {
  cacheDirectory: string
  cacheAutoCleanupEnabled: boolean
  cacheRetentionDays: number
  lyricsFontSize: number
  lyricsColorValue: number
  /** ChKSz API Key 池：多条 key 轮询分摊，失效自动切换（见 ChkszKeyPool） */
  chkszApiKeys: string[]
  /** 外观：浅色 / 深色 / 跟随系统（设置页三选一） */
  themeMode: ThemeMode
  shortcutSettings: ShortcutSettings
}

/** 主题模式 —— light/dark 为手动固定，system 跟随操作系统 */
export type ThemeMode = 'light' | 'dark' | 'system'

const DEFAULTS: AppSettingsSnapshot = {
  cacheDirectory: '',
  cacheAutoCleanupEnabled: true,
  cacheRetentionDays: 7,
  lyricsFontSize: 22,
  lyricsColorValue: 0xff1ed760,
  // 池默认空；构建期注入的 key 由 client 层兜底，不混进池（否则会把内置 key 展示给用户）
  chkszApiKeys: [],
  themeMode: 'system',
  shortcutSettings: ShortcutSettings.defaults(),
}

/** localStorage key —— 与 Dart SharedPreferences key 完全一致 */
export const APP_SETTINGS_KEYS = {
  cacheDirectory: 'settings_cache_directory',
  cacheAutoCleanupEnabled: 'settings_cache_auto_cleanup_enabled',
  cacheRetentionDays: 'settings_cache_retention_days',
  lyricsFontSize: 'settings_lyrics_font_size',
  lyricsColor: 'settings_lyrics_color',
  chkszApiKeys: 'settings_chksz_api_keys',
  themeMode: 'settings_theme_mode',
  shortcutSettings: 'settings_shortcuts',
} as const

export type AppSettingsListener = (snapshot: AppSettingsSnapshot) => void

export class AppSettings {
  private readonly storage: KeyValueStorage
  private snapshot: AppSettingsSnapshot
  private readonly listeners = new Set<AppSettingsListener>()
  /** system 模式下的 matchMedia 句柄；切到 light/dark 时释放，避免监听器重复注册 */
  private systemThemeQuery: MediaQueryList | null = null

  /** 系统主题变化回调：只在「跟随系统」时生效（手动选定后不被系统抢走） */
  private readonly onSystemThemeChange = (): void => {
    if (this.snapshot.themeMode === 'system') this.applyTheme('system')
  }

  constructor(storage?: KeyValueStorage) {
    this.storage = storage ?? createDefaultStorage()
    this.snapshot = this.load()
    // 启动即把主题落到 DOM —— 否则首帧会先按亮色渲染再跳暗色（闪白）
    this.watchSystemTheme(this.snapshot.themeMode)
    this.applyTheme(this.snapshot.themeMode)
  }

  private load(): AppSettingsSnapshot {
    const s = this.storage
    return {
      cacheDirectory: s.getString(APP_SETTINGS_KEYS.cacheDirectory) ?? DEFAULTS.cacheDirectory,
      cacheAutoCleanupEnabled: parseBool(
        s.getString(APP_SETTINGS_KEYS.cacheAutoCleanupEnabled),
        DEFAULTS.cacheAutoCleanupEnabled,
      ),
      cacheRetentionDays: parseNumber(
        s.getString(APP_SETTINGS_KEYS.cacheRetentionDays),
        DEFAULTS.cacheRetentionDays,
      ),
      lyricsFontSize: parseNumber(
        s.getString(APP_SETTINGS_KEYS.lyricsFontSize),
        DEFAULTS.lyricsFontSize,
      ),
      lyricsColorValue: parseNumber(
        s.getString(APP_SETTINGS_KEYS.lyricsColor),
        DEFAULTS.lyricsColorValue,
      ),
      // Key 池；首次读取时把旧版单 key 迁移进来（见 loadChkszApiKeys）
      chkszApiKeys: loadChkszApiKeys(s),
      themeMode: normalizeThemeMode(s.getString(APP_SETTINGS_KEYS.themeMode)),
      shortcutSettings: loadShortcutSettings(s),
    }
  }

  getSnapshot(): AppSettingsSnapshot {
    return { ...this.snapshot }
  }

  get cacheDirectory(): string {
    return this.snapshot.cacheDirectory
  }

  get cacheAutoCleanupEnabled(): boolean {
    return this.snapshot.cacheAutoCleanupEnabled
  }

  get cacheRetentionDays(): number {
    return this.snapshot.cacheRetentionDays
  }

  get lyricsFontSize(): number {
    return this.snapshot.lyricsFontSize
  }

  get lyricsColorValue(): number {
    return this.snapshot.lyricsColorValue
  }

  /** ChKSz Key 池（返回副本，调用方改动不会污染内部状态） */
  getChkszApiKeys(): string[] {
    return [...this.snapshot.chkszApiKeys]
  }

  get themeMode(): ThemeMode {
    return this.snapshot.themeMode
  }

  get shortcutSettings(): ShortcutSettings {
    return this.snapshot.shortcutSettings
  }

  setCacheDirectory(value: string): void {
    const normalized = value.trim()
    this.update({ cacheDirectory: normalized })
    this.storage.setString(APP_SETTINGS_KEYS.cacheDirectory, normalized)
  }

  useDefaultCacheDirectory(): void {
    this.setCacheDirectory('')
  }

  setCacheAutoCleanupEnabled(value: boolean): void {
    this.update({ cacheAutoCleanupEnabled: value })
    this.storage.setString(APP_SETTINGS_KEYS.cacheAutoCleanupEnabled, String(value))
  }

  setCacheRetentionDays(value: number): void {
    const normalized = Math.min(90, Math.max(1, Math.trunc(value)))
    this.update({ cacheRetentionDays: normalized })
    this.storage.setString(APP_SETTINGS_KEYS.cacheRetentionDays, String(normalized))
  }

  setLyricsFontSize(value: number): void {
    const normalized = Math.min(32, Math.max(16, value))
    this.update({ lyricsFontSize: normalized })
    this.storage.setString(APP_SETTINGS_KEYS.lyricsFontSize, String(normalized))
  }

  setLyricsColorValue(value: number): void {
    this.update({ lyricsColorValue: value })
    this.storage.setString(APP_SETTINGS_KEYS.lyricsColor, String(value))
  }

  /** 整体替换 ChKSz Key 池（设置页增/删一条即调用）；本地保存后立即生效 */
  setChkszApiKeys(value: readonly string[]): void {
    const normalized = normalizeKeyList(value)
    this.update({ chkszApiKeys: normalized })
    this.storage.setStringList(APP_SETTINGS_KEYS.chkszApiKeys, normalized)
  }

  /**
   * 切换外观并立即生效：写存储 → 重新绑定 system 监听 → 同步 html.dark。
   * 每次调用实时读取传入值（与其它设置一致），不做启动快照。
   */
  setThemeMode(value: ThemeMode): void {
    const mode = normalizeThemeMode(value)
    this.update({ themeMode: mode })
    this.storage.setString(APP_SETTINGS_KEYS.themeMode, mode)
    this.watchSystemTheme(mode)
    this.applyTheme(mode)
  }

  /** 把主题落到 DOM：只切 html.dark 类，具体颜色由 CSS 变量接管（React 无需参与） */
  private applyTheme(mode: ThemeMode): void {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle(
      'dark',
      resolveThemeIsDark(mode, this.systemPrefersDark()),
    )
  }

  private systemPrefersDark(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  /** system 模式注册 change 监听；light/dark 时移除（重复调用不会叠加监听器） */
  private watchSystemTheme(mode: ThemeMode): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    if (mode === 'system') {
      if (this.systemThemeQuery != null) return
      this.systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
      this.systemThemeQuery.addEventListener('change', this.onSystemThemeChange)
    } else if (this.systemThemeQuery != null) {
      this.systemThemeQuery.removeEventListener('change', this.onSystemThemeChange)
      this.systemThemeQuery = null
    }
  }

  setShortcutSettings(value: ShortcutSettings): void {
    this.update({ shortcutSettings: value })
    this.storage.setString(APP_SETTINGS_KEYS.shortcutSettings, JSON.stringify(value.toJson()))
  }

  /** 全局热键开关（设置页一个开关就够，其余键位暂用默认） */
  setGlobalHotkeysEnabled(value: boolean): void {
    this.setShortcutSettings(
      this.snapshot.shortcutSettings.copyWith({ globalHotkeysEnabled: value }),
    )
  }

  /** 订阅变更；返回退订函数 */
  subscribe(listener: AppSettingsListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private update(patch: Partial<AppSettingsSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    const current = this.getSnapshot()
    for (const listener of this.listeners) listener(current)
  }
}

/** 旧版单 Key 的存储 key（与 Dart SharedPreferences 同名）；只用于迁移，不再写入 */
const LEGACY_CHKSZ_KEY_STORAGE = 'settings_chksz_api_key'

/**
 * 读 ChKSz Key 池。首次读取（新 key 不存在）时把旧版单 key 迁移进池（见
 * migrateLegacyChkszKey）：写新 key → 删旧 key，之后旧 key 永不再读，
 * 避免「删了又自己回来」。
 */
function loadChkszApiKeys(storage: KeyValueStorage): string[] {
  if (storage.getString(APP_SETTINGS_KEYS.chkszApiKeys) != null) {
    return normalizeKeyList(storage.getStringList(APP_SETTINGS_KEYS.chkszApiKeys))
  }
  return migrateLegacyChkszKey(storage)
}

/**
 * 把旧版单 key（settings_chksz_api_key）迁移进池，返回迁移后的池内容。
 *
 * 构建期注入的 key（VITE_CHKSZ_API_KEY）**不迁入池**：它由 client 在池为空时兜底，
 * 与「用户在设置页配置的 key」是两回事。旧版设置页的输入框预填的就是
 * snapshot.chkszApiKey（默认值即构建期 key），用户点一次保存就把它写进了
 * settings_chksz_api_key；迁进池等于把内置 key 展示给用户，并改变兜底语义。
 * 旧存储项无论如何都删除，避免每次启动重复判断。
 *
 * builtIn 可注入：node 测试环境读不到 import.meta.env 注入值（恒为空串），
 * 注入假值才能覆盖「旧值 == 构建期 key → 不迁入」这条分支。
 */
export function migrateLegacyChkszKey(
  storage: KeyValueStorage,
  builtIn: string = BUILD_TIME_CHKSZ_API_KEY,
): string[] {
  const legacy = storage.getString(LEGACY_CHKSZ_KEY_STORAGE)?.trim() ?? ''
  if (legacy === '') {
    storage.remove(LEGACY_CHKSZ_KEY_STORAGE)
    return []
  }
  const builtInKey = builtIn.trim()
  if (builtInKey !== '' && legacy === builtInKey) {
    storage.remove(LEGACY_CHKSZ_KEY_STORAGE)
    return []
  }
  const migrated = normalizeKeyList([legacy])
  storage.setStringList(APP_SETTINGS_KEYS.chkszApiKeys, migrated)
  storage.remove(LEGACY_CHKSZ_KEY_STORAGE)
  return migrated
}

/** 读快捷键设置；解析失败/未设置 → 默认键位（Dart `_loadShortcutSettings`） */
function loadShortcutSettings(storage: KeyValueStorage): ShortcutSettings {
  const raw = storage.getString(APP_SETTINGS_KEYS.shortcutSettings)
  if (raw == null || raw.trim() === '') return ShortcutSettings.defaults()
  try {
    return ShortcutSettings.fromJson(JSON.parse(raw))
  } catch {
    return ShortcutSettings.defaults()
  }
}

function parseBool(raw: string | null, fallback: boolean): boolean {
  if (raw == null) return fallback
  if (raw === 'true') return true
  if (raw === 'false') return false
  return fallback
}

/** 收窄到三值之一；非法/缺失（旧版本存储、脏数据）一律回落到 system */
export function normalizeThemeMode(raw: unknown): ThemeMode {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

/** 「跟随系统」时实际是否应用暗色（纯函数，便于单测） */
export function resolveThemeIsDark(mode: ThemeMode, systemPrefersDark: boolean): boolean {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return systemPrefersDark
}

function parseNumber(raw: string | null, fallback: number): number {
  if (raw == null) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}
