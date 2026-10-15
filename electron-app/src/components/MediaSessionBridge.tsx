/**
 * 系统媒体会话（SMTC）—— 对照 BiliMusic 的 navigator.mediaSession 用法：
 * Windows 系统音量浮层 / 锁屏 / 媒体键会显示封面、标题、歌手，
 * 且播放/暂停/上一首/下一首/seek 都能从系统层控制应用。
 *
 * 挂在主窗口一次（App 的 Shell 内），读 PlayerContext 同步到 mediaSession。
 */

import { useEffect, useRef } from 'react'
import { usePlayer, usePlayerTime } from '../contexts/PlayerContext'
import { songCover, toSong } from '../state/songUtils'

export function MediaSessionBridge() {
  const player = usePlayer()
  const time = usePlayerTime()

  // 动作处理器只注册一次：player 对象每次状态变更都会新建，直接依赖它会导致
  // 处理器被反复注销/重注册（与注释「只需注册一次」相矛盾）。用 ref 取最新引用。
  const playerRef = useRef(player)
  playerRef.current = player

  // 元数据：换歌 / 封面变化时刷新
  const songId = player.currentSong?.['id']?.toString() ?? null
  const coverUrl = player.currentSong != null ? songCover(toSong(player.currentSong)) : null
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (player.currentSong == null) {
      navigator.mediaSession.metadata = null
      return
    }
    const song = toSong(player.currentSong)
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      album: song.extra['album']?.toString() ?? '',
      artwork: coverUrl != null ? [{ src: coverUrl, sizes: '512x512', type: 'image/jpeg' }] : [],
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, coverUrl])

  // 播放态
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = player.isPlaying ? 'playing' : 'paused'
  }, [player.isPlaying])

  // 进度（系统浮层的进度条）
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!Number.isFinite(time.duration) || time.duration <= 0) return
    try {
      navigator.mediaSession.setPositionState({
        duration: time.duration,
        playbackRate: 1,
        position: Math.min(time.currentTime, time.duration),
      })
    } catch {
      /* 某些 Chromium 版本对非法 position 抛错，忽略 */
    }
  }, [time.currentTime, time.duration])

  // 系统层动作 → 播放器（处理器只需注册一次）
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => playerRef.current.togglePlay()],
      ['pause', () => playerRef.current.togglePlay()],
      ['previoustrack', () => playerRef.current.prev()],
      ['nexttrack', () => playerRef.current.next()],
      [
        'seekto',
        (details) => {
          if (details.seekTime != null) playerRef.current.seek(details.seekTime)
        },
      ],
    ]
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
      } catch {
        /* 个别 action 不支持则跳过 */
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null)
        } catch {
          /* ignore */
        }
      }
    }
  }, [])

  return null
}
