/**
 * LRC 歌词解析 —— 供歌词抽屉做行级高亮、自动滚动与点击跳转。
 *
 * 兼容：
 * - NetEase / ChKSz 返回的 `[mm:ss.xx]文本` 行，以及一行多时间戳（`[00:01.00][00:05.00]副歌`）
 * - 元信息标签（`[ti:]` `[by:]` `[offset:]` 等）直接忽略
 * - 翻译歌词：紧跟原文且无时间戳的行并入上一行（渲染为第二行）
 * - 纯文本歌词（无任何时间戳）→ parseLyrics 返回空数组，由调用方退化为普通排版
 */

import {
  LRC_TIMESTAMP_PATTERN as TIMESTAMP_PATTERN,
  lrcToSeconds as toSeconds,
} from '../services/lrcTimestamp'

export interface LyricLine {
  /** 起始时间（秒） */
  time: number
  /** 文本，可能含换行（原文 + 翻译） */
  text: string
}

const META_ONLY_PATTERN = /^\[[a-zA-Z#]+:[^\]]*\]$/

/** 去掉时间戳与元信息后剩下的纯文本行（无时间戳歌词的展示兜底） */
export function plainLyricLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(TIMESTAMP_PATTERN, '').trim())
    .filter((line) => line !== '' && !META_ONLY_PATTERN.test(line))
}

export function parseLyrics(raw: string): LyricLine[] {
  const text = raw.trim()
  if (text === '') return []

  const lines: LyricLine[] = []
  let last: LyricLine | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || META_ONLY_PATTERN.test(line)) continue

    TIMESTAMP_PATTERN.lastIndex = 0
    const stamps: number[] = []
    let match: RegExpExecArray | null
    while ((match = TIMESTAMP_PATTERN.exec(line)) != null) {
      stamps.push(toSeconds(match[1], match[2], match[3]))
    }
    const content = line.replace(TIMESTAMP_PATTERN, '').trim()

    if (stamps.length === 0) {
      // 无时间戳：当作上一行的翻译/补充（原文与翻译同一时间点）
      if (content !== '' && last != null) last.text = `${last.text}\n${content}`
      continue
    }

    for (const time of stamps) {
      const entry: LyricLine = { time, text: content }
      lines.push(entry)
      last = entry
    }
  }

  lines.sort((a, b) => a.time - b.time)
  return lines
}

/** 当前时间对应的歌词行下标；未到第一行时返回 -1 */
export function activeLyricIndex(lines: LyricLine[], time: number): number {
  if (lines.length === 0) return -1
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= time + 0.1) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}
