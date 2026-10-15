/** 歌曲展示工具 —— RawSong / Song 统一归一到 Song */

import { songFromJson, type Song } from '../services/models'

export type RawSong = Record<string, unknown>

/** 搜索/播放层返回的 RawSong 与库层的 Song 都归一为 Song */
export function toSong(raw: RawSong | Song): Song {
  return songFromJson(raw as Record<string, unknown>)
}

export function toSongs(list: Array<RawSong | Song>): Song[] {
  return list.map(toSong)
}

/** 时长 → 秒。与 Dart 一致：extra.duration 是**毫秒**（数值/纯数字字符串都按毫秒），
 *  否则解析 "m:ss" 展示字符串。 */
export function durationSeconds(song: Song): number {
  const raw = song.extra['duration']
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw / 1000
  }
  if (typeof raw === 'string') {
    const numeric = Number.parseFloat(raw)
    if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(raw.trim())) {
      return numeric / 1000
    }
    const m = /^(\d+):(\d{1,2})$/.exec(raw.trim())
    if (m != null) return Number.parseInt(m[1], 10) * 60 + Number.parseInt(m[2], 10)
  }
  const m = /^(\d+):(\d{1,2})$/.exec(song.duration.trim())
  if (m != null) return Number.parseInt(m[1], 10) * 60 + Number.parseInt(m[2], 10)
  return 0
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatTotalDuration(seconds: number): string {
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h} 小时 ${m} 分钟`
  return `${m} 分钟`
}

export function songCover(song: Song): string | null {
  const url = song.coverUrl?.trim()
  return url != null && url !== '' ? url : null
}
