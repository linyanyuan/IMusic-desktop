/**
 * 歌单「整单播放」—— 首页今日精选大卡与分类页热门歌单卡共用。
 *
 * 两处卡片的悬浮播放键走同一条异步流程：按 id 取歌单曲目 → 有曲目就整单播放；
 * 取不到或请求失败则退化为「进入歌单详情」（详情页自己会再加载一次，用户不至于
 * 点了没反应）。抽成一个 hook 是为了让这个 fallback 行为只有一份实现，避免两处
 * 各自演化后不一致（曾经就是两份逐行重复的代码）。
 */

import { useState } from 'react'
import { DeskRoute, useRoute } from './route'
import { toSongs } from './songUtils'
import { getServices } from '../services/runtime'
import { usePlayer } from '../contexts/PlayerContext'
import type { Song } from '../services/models'

export function usePlayPlaylist(playlist: Song): {
  /** 正在取歌单曲目（卡片播放键据此转圈并禁用） */
  resolving: boolean
  /** 整单播放：取回首曲作为起点、全部曲目作为播放队列；取不到则进详情 */
  playAll: () => Promise<void>
} {
  const route = useRoute()
  const player = usePlayer()
  const [resolving, setResolving] = useState(false)

  const open = () => route.go(DeskRoute.PlaylistDetail, { playlistId: playlist.id })

  const playAll = async () => {
    setResolving(true)
    try {
      const detail = await getServices().music.getPlaylist(playlist.id)
      const songs = toSongs(
        Array.isArray(detail['songs']) ? (detail['songs'] as Record<string, unknown>[]) : [],
      )
      if (songs.length > 0) {
        player.playSong(songs[0].extra, songs.map((s) => s.extra))
      } else {
        open()
      }
    } catch {
      open()
    } finally {
      setResolving(false)
    }
  }

  return { resolving, playAll }
}
