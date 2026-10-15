/**
 * 合集歌词工具 —— 移植自 lib/shared/collection_lyrics.dart。
 * B 站合集（一个视频含多首歌）拆出《歌名》段，各自取词后按总时长
 * 均摊偏移合并成一条带时间戳的歌词。
 */

import { LRC_TIMESTAMP_SOURCE, lrcToMilliseconds } from './lrcTimestamp'

export interface CollectionLyricSegment {
  title: string
  lyrics: string
}

export function extractQuotedSongTitles(title: string): string[] {
  const seen = new Set<string>()
  const titles: string[] = []
  let previousClose = -1

  for (let i = 0; i < title.length; i++) {
    if (title[i] !== '》') continue

    const segment = title.substring(previousClose + 1, i).trim()
    previousClose = i
    if (segment === '') continue

    const openIndex = segment.lastIndexOf('《')
    const item = (openIndex >= 0 ? segment.substring(openIndex + 1) : segment).trim()
    if (item === '' || seen.has(item)) continue
    seen.add(item)
    titles.push(item)
  }

  return titles
}

const TIMESTAMP_PATTERN = new RegExp(LRC_TIMESTAMP_SOURCE)
const GLOBAL_TIMESTAMP_PATTERN = new RegExp(LRC_TIMESTAMP_SOURCE, 'g')

function hasTimestamp(lyrics: string): boolean {
  return TIMESTAMP_PATTERN.test(lyrics)
}

/** segments 合并；totalDurationMs 单位毫秒 */
export function combineCollectionLyrics(
  segments: CollectionLyricSegment[],
  totalDurationMs: number,
): string {
  if (segments.length === 0) return ''

  const segmentMs = totalDurationMs > 0 ? Math.floor(totalDurationMs / segments.length) : 0
  const output: string[] = []

  for (let i = 0; i < segments.length; i++) {
    const lyrics = segments[i].lyrics.trim()
    if (lyrics === '') continue

    const offsetMs = segmentMs * i
    const shifted = hasTimestamp(lyrics)
      ? shiftTimedLyrics(lyrics, offsetMs)
      : spreadPlainLyrics(lyrics, offsetMs, segmentMs)

    if (shifted.trim() !== '') output.push(shifted.trim())
  }

  return output.join('\n')
}

function shiftTimedLyrics(lyrics: string, offsetMs: number): string {
  return lyrics
    .split('\n')
    .map((line) =>
      line.replace(
        GLOBAL_TIMESTAMP_PATTERN,
        (_m, mm: string, ss: string, frac?: string) =>
          formatTimestamp(lrcToMilliseconds(mm, ss, frac) + offsetMs),
      ),
    )
    .join('\n')
}

function spreadPlainLyrics(lyrics: string, offsetMs: number, segmentMs: number): string {
  const lines = lyrics
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length === 0) return ''

  const stepMs = segmentMs > 0 ? Math.floor(segmentMs / lines.length) : 0
  return lines
    .map((line, i) => `${formatTimestamp(offsetMs + stepMs * i)}${line}`)
    .join('\n')
}

function formatTimestamp(totalMs: number): string {
  const minutes = Math.floor(totalMs / 60000).toString().padStart(2, '0')
  const seconds = (Math.floor(totalMs / 1000) % 60).toString().padStart(2, '0')
  const hundredths = (Math.floor((totalMs % 1000) / 10)).toString().padStart(2, '0')
  return `[${minutes}:${seconds}.${hundredths}]`
}
