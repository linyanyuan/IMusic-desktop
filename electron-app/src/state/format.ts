/**
 * 展示格式化工具 —— 缓存视图（SettingsView / LibraryView）共用，
 * 避免同一份 cacheStats 结果在两处用不同实现格式化而分叉。
 */

/** 字节 → 人类可读（0 B / 1.5 MB / 320 MB） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
