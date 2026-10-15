/**
 * 应用设置 —— 移植自 lib/services/app_settings.dart。
 * SharedPreferences 等价物为 localStorage（经 storage 适配层，可注入内存实现），
 * key 名字符串与 Dart 端完全一致。
 *
 * 语义取舍：
 * - shortcutSettings（快捷键映射）与 Dart 端结构、storage key 完全一致（settings_shortcuts）。
 * - cacheDirectory 的"默认路径解析"依赖 path_provider，Electron 端由主进程决定，
 *   这里只保留设置值的读写。
 * - ChKSz API key 优先级：设置页写入 localStorage 的值 > 构建期注入
 *   （import.meta.env.VITE_CHKSZ_API_KEY ?? ''），与 Dart 端
 *   `--dart-define=CHKSZ_API_KEY` 的兜底角色一致。
 */

import { createDefaultStorage, type KeyValueStorage } from './storage'
import { ShortcutSettings } from './shortcutSettings'

/** 构建期注入的兜底 key；仓库内不硬编码真实 key */
// SAFETY: import.meta.env 的类型由 Vite 在构建期注入，独立 tsc 类型检查时没有
// vite/client 声明，这里收窄为可选 env 形状；env 缺失时 ?? '' 兜底，不会解引用 undefined。
const BUILD_TIME_CHKSZ_API_KEY: string =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_CHKSZ_API_KEY ?? ''

export interface AppSettingsSnapshot {
  cacheDirectory: string
  cacheAutoCleanupEnabled: boolean
  cacheRetentionDays: number
  lyricsFontSize: number
  lyricsColorValue: number
  chkszApiKey: string
  shortcutSettings: ShortcutSettings
}

const DEFAULTS: AppSettingsSnapshot = {
  cacheDirectory: '',
  cacheAutoCleanupEnabled: true,
  cacheRetentionDays: 7,
  lyricsFontSize: 22,
  lyricsColorValue: 0xff1ed760,
  chkszApiKey: BUILD_TIME_CHKSZ_API_KEY,
  shortcutSettings: ShortcutSettings.defaults(),
}

/** localStorage key —— 与 Dart SharedPreferences key 完全一致 */
export const APP_SETTINGS_KEYS = {
  cacheDirectory: 'settings_cache_directory',
  cacheAutoCleanupEnabled: 'settings_cache_auto_cleanup_enabled',
  cacheRetentionDays: 'settings_cache_retention_days',
  lyricsFontSize: 'settings_lyrics_font_size',
  lyricsColor: 'settings_lyrics_color',
  chkszApiKey: 'settings_chksz_api_key',
  shortcutSettings: 'settings_shortcuts',
} as const

export type AppSettingsListener = (snapshot: AppSettingsSnapshot) => void

export class AppSettings {
  private readonly storage: KeyValueStorage
  private snapshot: AppSettingsSnapshot
  private readonly listeners = new Set<AppSettingsListener>()

  constructor(storage?: KeyValueStorage) {
    this.storage = storage ?? createDefaultStorage()
    this.snapshot = this.load()
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
      // 设置页值优先；从未设置过时回落到构建期注入值
      chkszApiKey: s.getString(APP_SETTINGS_KEYS.chkszApiKey) ?? BUILD_TIME_CHKSZ_API_KEY,
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

  getChkszApiKey(): string {
    return this.snapshot.chkszApiKey
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

  /** ChKSz API key，本地保存，设置页修改后无需重新构建 */
  setChkszApiKey(value: string): void {
    const normalized = value.trim()
    this.update({ chkszApiKey: normalized })
    this.storage.setString(APP_SETTINGS_KEYS.chkszApiKey, normalized)
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

function parseNumber(raw: string | null, fallback: number): number {
  if (raw == null) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}
