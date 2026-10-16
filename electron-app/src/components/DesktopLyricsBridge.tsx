/**
 * 主窗口侧的桌面歌词桥 —— 对应 Flutter LyricsWindowManager：
 * 把播放状态（歌曲 / 歌词 / 进度 / 播放态 / 字号 / 颜色 / 收藏态）经主进程转发
 * 给独立歌词窗口，并执行歌词窗口回发的控制命令
 * （上一首 / 播放暂停 / 下一首 / 收藏）。
 *
 * 节流策略：进度 ~4Hz，全量转发浪费 IPC ——
 *   - 换歌 / 歌词 / 播放态 / 收藏 / 设置变化：立即发（歌词行要马上换）
 *   - 纯进度变化：按 500ms 节流（歌词行粒度足够）
 */

import { useEffect, useRef, useState } from 'react'
import { usePlayer, usePlayerTime } from '../contexts/PlayerContext'
import { useAuth, useLibrary, useSettings } from '../state/hooks'
import { toggleLikeGuarded } from '../state/likeAction'
import { toSong } from '../state/songUtils'

const PROGRESS_INTERVAL_MS = 500

/** 轻量内容指纹：歌词改了但长度不变时也能触发立即推送 */
function hashText(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
  return hash
}

export function DesktopLyricsBridge() {
  const player = usePlayer()
  const time = usePlayerTime()
  const library = useLibrary()
  const auth = useAuth()
  const settings = useSettings()
  const lastSentRef = useRef(0)
  const lastCoreRef = useRef('')
  // 命令监听只注册一次：用 ref 取最新引用（player/library/song 每次渲染都可能变新对象）
  const playerRef = useRef(player)
  playerRef.current = player
  const libraryRef = useRef(library)
  libraryRef.current = library
  const authRef = useRef(auth)
  authRef.current = auth
  // 歌词窗口刚打开时强制推一次当前状态，否则要等到下一次播放态变化才显示
  const [pushTick, setPushTick] = useState(0)

  const song = player.currentSong
  const songId = song?.['id']?.toString() ?? null
  const songRef = useRef(song)
  songRef.current = song
  const snapshot = settings.getSnapshot()
  const songModel = song != null ? toSong(song) : null
  // 与 PlayerBar 一致：用身份比较，否则 B 站分P歌收藏后心形不高亮
  const isFavorite = songModel != null && library.isLiked(songModel)

  // 状态推送
  useEffect(() => {
    const api = window.imusicAPI
    if (api?.lyricsSendState == null) return

    // 换歌 / 歌词 / 播放态 / 收藏 / 设置变化要绕过节流立即发
    const core = `${pushTick}|${songId}|${hashText(player.lyrics)}|${player.isPlaying}|${isFavorite}|${snapshot.lyricsFontSize}|${snapshot.lyricsColorValue}`
    const coreChanged = core !== lastCoreRef.current
    lastCoreRef.current = core

    const now = Date.now()
    if (!coreChanged && now - lastSentRef.current < PROGRESS_INTERVAL_MS) return
    lastSentRef.current = now

    api.lyricsSendState({
      song,
      lyrics: player.lyrics,
      currentTime: time.currentTime,
      duration: time.duration,
      isPlaying: player.isPlaying,
      fontSize: snapshot.lyricsFontSize,
      colorValue: snapshot.lyricsColorValue,
      isFavorite,
      canFavorite: song != null,
    })
  }, [
    pushTick,
    songId,
    song,
    player.lyrics,
    player.isPlaying,
    time.currentTime,
    time.duration,
    isFavorite,
    snapshot.lyricsFontSize,
    snapshot.lyricsColorValue,
  ])

  // 歌词窗口打开时立即推一次当前播放状态（否则新窗口停在默认态「暂无歌词」）
  useEffect(() => {
    const api = window.imusicAPI
    if (api?.onLyricsToggled == null) return
    return api.onLyricsToggled((open) => {
      if (open) setPushTick((n) => n + 1)
    })
  }, [])

  // 歌词窗口回发的控制命令（对照 Flutter 的 previous / playPause / next / toggleFavorite）
  useEffect(() => {
    const api = window.imusicAPI
    if (api?.onLyricsCommand == null) return
    return api.onLyricsCommand((command) => {
      if (command === 'togglePlay') playerRef.current.togglePlay()
      else if (command === 'prev') playerRef.current.prev()
      else if (command === 'next') playerRef.current.next()
      else if (command === 'toggleFavorite') {
        const current = songRef.current
        if (current != null) {
          toggleLikeGuarded(authRef.current, libraryRef.current, toSong(current))
        }
      }
    })
  }, [])

  return null
}
