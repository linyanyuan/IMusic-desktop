/**
 * 最近搜索 —— 纯逻辑核（localStorage 可注入，便于 node --test 单测）。
 *
 * 设计意图：
 * - 原来这套逻辑散在 SearchView 里（模块级 RECENT_KEY/loadRecent/pushRecent），
 *   既没法单测，也顺手继承了两个 bug：空关键词回车会往历史里塞一条空条目、
 *   历史一旦写坏（空串/非字符串）就永远显示为空 chip。这里收敛成一份纯函数，
 *   读取时顺带自愈坏数据。
 * - 组件不该直接碰存储：storage 省略时才用 globalThis.localStorage，测试注入内存假存储；
 *   拿不到存储（SSR / 隐私模式 / 权限异常）一律当作**空存储** —— 读返回 []、写静默忽略，
 *   绝不因为存储不可用让搜索页崩掉。
 * - 所有导出函数都返回**新数组**，不改动入参。
 */

/** localStorage 中保存最近搜索的 key */
export const RECENT_SEARCHES_KEY = 'imusic:recentSearches'

/** 最多保留的历史条数（新→旧） */
export const RECENT_SEARCHES_MAX = 8

/** 只用到这几个方法的存储抽象，便于测试注入内存实现 */
export interface RecentSearchStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * 解析出实际使用的存储：
 * - 显式传了 storage（含 null）就用它 —— null 表示「无存储」；
 * - 省略时用 globalThis.localStorage；不存在或访问即抛（隐私模式）时返回 null。
 */
function resolveStorage(
  storage?: RecentSearchStorage | null,
): RecentSearchStorage | null {
  if (storage !== undefined) return storage
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

/**
 * 读取并**规范化**列表：
 * - getItem / JSON.parse 抛异常、结果不是数组 → 一律降级为 []；
 * - 过滤非字符串元素、过滤 trim 后为空白的元素（历史坏数据的自愈）；
 * - 元素统一 trim，并对 trim 后相同的条目去重（保证 React key 唯一、chip 不重复）。
 */
function readList(storage: RecentSearchStorage | null): string[] {
  if (storage == null) return []
  let raw: string | null
  try {
    raw = storage.getItem(RECENT_SEARCHES_KEY)
  } catch {
    return []
  }
  if (raw == null) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const list: string[] = []
  const seen = new Set<string>()
  for (const item of parsed) {
    if (typeof item !== 'string') continue
    const value = item.trim()
    if (value === '' || seen.has(value)) continue
    seen.add(value)
    list.push(value)
  }
  return list
}

/** 写回列表；配额不足/存储不可用时静默忽略（调用方仍拿内存里算好的列表） */
function writeList(storage: RecentSearchStorage | null, list: string[]): void {
  if (storage == null) return
  try {
    storage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

/**
 * 读取最近搜索（新→旧）。坏数据/无存储都安全降级为 []。
 */
export function loadRecentSearches(storage?: RecentSearchStorage | null): string[] {
  return readList(resolveStorage(storage))
}

/**
 * 把关键词推到列表最前，返回新列表。
 * - 先 trim；**trim 后为空 → 原样返回当前列表、不写入**（空回车不该产生空历史条目）；
 * - 已存在（trim 后相同）的旧条目先移除再插到最前（去重 + 置顶）；
 * - 最多保留 RECENT_SEARCHES_MAX 条。
 */
export function pushRecentSearch(
  query: string,
  storage?: RecentSearchStorage | null,
): string[] {
  const store = resolveStorage(storage)
  const current = readList(store)
  const value = query.trim()
  if (value === '') return current

  const next = [value, ...current.filter((item) => item !== value)].slice(
    0,
    RECENT_SEARCHES_MAX,
  )
  writeList(store, next)
  return next
}

/**
 * 删除某条历史（按 trim 后的精确匹配，不存在则列表内容不变），返回新列表。
 */
export function removeRecentSearch(
  query: string,
  storage?: RecentSearchStorage | null,
): string[] {
  const store = resolveStorage(storage)
  const current = readList(store)
  const value = query.trim()
  const next = current.filter((item) => item !== value)
  writeList(store, next)
  return next
}

/**
 * 清空最近搜索：直接删除整个 key，返回 []。
 */
export function clearRecentSearches(storage?: RecentSearchStorage | null): string[] {
  const store = resolveStorage(storage)
  if (store != null) {
    try {
      store.removeItem(RECENT_SEARCHES_KEY)
    } catch {
      /* ignore */
    }
  }
  return []
}
