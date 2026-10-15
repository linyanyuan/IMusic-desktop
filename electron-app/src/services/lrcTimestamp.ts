/**
 * LRC 时间戳解析的单一实现 —— 供 state/lyrics.ts（行级高亮）与
 * services/collectionLyrics.ts（合集会话偏移）共用，避免两处正则/精度分叉。
 *
 * 兼容 `[mm:ss]`、`[mm:ss.xx]`、`[mm:ss:xx]`（分钟最多 3 位，秒 1-2 位）。
 */

export const LRC_TIMESTAMP_SOURCE = '\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]'

/** 带 /g 的全局正则（调用方如需 exec 请自行重置 lastIndex，或使用 replace） */
export const LRC_TIMESTAMP_PATTERN = new RegExp(LRC_TIMESTAMP_SOURCE, 'g')

/** 时间戳 → 秒；小数位按厘秒补齐（[00:01.5] → 0.5s） */
export function lrcToSeconds(
  minutes: string,
  seconds: string,
  fraction?: string,
): number {
  const ms = fraction == null ? 0 : Number(fraction.padEnd(3, '0'))
  return Number(minutes) * 60 + Number(seconds) + ms / 1000
}

/** 时间戳 → 毫秒（合集会话偏移用） */
export function lrcToMilliseconds(
  minutes: string,
  seconds: string,
  fraction?: string,
): number {
  return Math.round(lrcToSeconds(minutes, seconds, fraction) * 1000)
}
