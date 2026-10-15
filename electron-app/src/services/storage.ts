/**
 * 键值存储适配层 —— 等价 Flutter 的 SharedPreferences。
 * 默认走 localStorage；测试时可注入 MemoryStorage。
 * key 名字符串与 Dart 端保持完全一致。
 */

export interface KeyValueStorage {
  getString(key: string): string | null
  setString(key: string, value: string): void
  /** 等价 SharedPreferences.getStringList（localStorage 中以 JSON 数组落地） */
  getStringList(key: string): string[]
  setStringList(key: string, value: string[]): void
  remove(key: string): void
}

/** 内存实现，供单元测试或无 localStorage 的环境使用 */
export class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, string>()

  getString(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null
  }

  setString(key: string, value: string): void {
    this.data.set(key, value)
  }

  getStringList(key: string): string[] {
    const raw = this.getString(key)
    if (raw == null) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.map((item) => String(item))
    } catch {
      /* 忽略损坏数据，与 Dart 端容错一致 */
    }
    return []
  }

  setStringList(key: string, value: string[]): void {
    this.data.set(key, JSON.stringify(value))
  }

  remove(key: string): void {
    this.data.delete(key)
  }
}

/** localStorage 实现；string list 以 JSON 数组字符串存储在同一 key 下 */
export class LocalStorageAdapter implements KeyValueStorage {
  private readonly backend: Storage

  constructor(backend: Storage) {
    this.backend = backend
  }

  getString(key: string): string | null {
    return this.backend.getItem(key)
  }

  setString(key: string, value: string): void {
    this.backend.setItem(key, value)
  }

  getStringList(key: string): string[] {
    const raw = this.backend.getItem(key)
    if (raw == null) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.map((item) => String(item))
    } catch {
      /* 忽略损坏数据 */
    }
    return []
  }

  setStringList(key: string, value: string[]): void {
    this.backend.setItem(key, JSON.stringify(value))
  }

  remove(key: string): void {
    this.backend.removeItem(key)
  }
}

/** 环境有 localStorage 就用 localStorage，否则退化为内存实现（不抛错） */
export function createDefaultStorage(): KeyValueStorage {
  if (typeof localStorage !== 'undefined') {
    return new LocalStorageAdapter(localStorage)
  }
  return new MemoryStorage()
}
