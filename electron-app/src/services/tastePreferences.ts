/**
 * 音乐口味偏好 —— localStorage key `imusic:tastePreferences`。
 *
 * 结构 `{ genres: string[]（genre key）, skipped: boolean, updatedAt }`。
 * 与项目其它设置一致：**每次调用实时读取**（不做启动快照），写完后通知订阅者，
 * 首页/设置页据此立刻重算推荐。
 *
 * 容错：损坏 JSON、非对象、字段类型不对时一律回退默认值（空偏好 + 未跳过），
 * 绝不把脏数据抛出到 UI。
 */

import { createDefaultStorage, type KeyValueStorage } from './storage'
import { MAX_TASTE_GENRES, normalizeGenreKeys } from '../state/genres'

export const TASTE_PREFERENCES_KEY = 'imusic:tastePreferences'

export interface TastePreferences {
  /** 已选分类（genre key），最多 MAX_TASTE_GENRES 个 */
  genres: string[]
  /** 用户点过「跳过」：不再自动弹出引导卡（但仍可手动「调整口味」） */
  skipped: boolean
  /** 最近一次修改时间（ISO）；'' 表示从未设置过 */
  updatedAt: string
}

export const DEFAULT_TASTE_PREFERENCES: TastePreferences = {
  genres: [],
  skipped: false,
  updatedAt: '',
}

export type TastePreferencesListener = (preferences: TastePreferences) => void

/** 是否已有可用偏好（决定首页走个性化还是默认推荐） */
export function hasTastePreferences(preferences: TastePreferences): boolean {
  return preferences.genres.length > 0
}

/** 是否需要展示首次引导卡：从未设置过且没跳过 */
export function shouldOfferTasteOnboarding(preferences: TastePreferences): boolean {
  return preferences.updatedAt === '' && !preferences.skipped
}

export class TastePreferencesStore {
  private readonly storage: KeyValueStorage
  private readonly listeners = new Set<TastePreferencesListener>()

  constructor(storage: KeyValueStorage = createDefaultStorage()) {
    this.storage = storage
  }

  /** 实时读取（每次调用都重新解析存储，不做缓存） */
  get(): TastePreferences {
    const raw = this.storage.getString(TASTE_PREFERENCES_KEY)
    if (raw == null || raw.trim() === '') return { ...DEFAULT_TASTE_PREFERENCES }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ...DEFAULT_TASTE_PREFERENCES }
      }
      const record = parsed as Record<string, unknown>
      return {
        genres: normalizeGenreKeys(record['genres']).slice(0, MAX_TASTE_GENRES),
        skipped: record['skipped'] === true,
        updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : '',
      }
    } catch {
      // 损坏 JSON：回退默认而不是抛错
      return { ...DEFAULT_TASTE_PREFERENCES }
    }
  }

  /**
   * 写入偏好。genres 会过滤未知 key、去重并截断到上限 5；
   * 传 `genres: []` 且 skipped 为 false 时等价于「有偏好但空」——仍标记 updatedAt，
   * 表示用户已做过选择（避免引导卡再次弹出）；「清除」请用 clear()。
   */
  set(input: { genres: string[]; skipped?: boolean }): TastePreferences {
    const next: TastePreferences = {
      genres: normalizeGenreKeys(input.genres).slice(0, MAX_TASTE_GENRES),
      skipped: input.skipped === true,
      updatedAt: new Date().toISOString(),
    }
    this.storage.setString(TASTE_PREFERENCES_KEY, JSON.stringify(next))
    this.emit(next)
    return next
  }

  /** 「跳过」：不计偏好，但不再自动引导 */
  skip(): TastePreferences {
    return this.set({ genres: [], skipped: true })
  }

  /** 清除偏好 —— 回到默认推荐，且引导卡可以再次出现 */
  clear(): void {
    this.storage.remove(TASTE_PREFERENCES_KEY)
    this.emit({ ...DEFAULT_TASTE_PREFERENCES })
  }

  subscribe(listener: TastePreferencesListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(preferences: TastePreferences): void {
    for (const listener of this.listeners) listener(preferences)
  }
}

/** 全局单例（与 settings/library 一致的「服务层每次实时读取」语义） */
export const tastePreferences = new TastePreferencesStore()
