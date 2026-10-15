/**
 * 歌单详情 —— 三种来源：
 *   1. 自建歌单（library.userPlaylists，可增删）
 *   2. 我喜欢的音乐（playlistId === 'favorites'）
 *   3. 远端歌单（B站合集 / ChKSz 网易云歌单 / 元数据歌单 —— 按 id 前缀交给 MusicService 解析）
 *
 * 第 3 种是首页「热门歌单」与搜索「B站歌单」的落点：这些歌单不在本地库里，
 * 必须按 id 去 provider 取（对应 Dart 端 desktop_playlist_detail_screen 的
 * `musicService.getPlaylist(playlistId)`）。此前只查本地库，于是点进去永远是
 * 「歌单不存在或已被删除」—— 首页功能看起来就是「没打通」。
 */

import { useEffect, useMemo, useState } from 'react'
import { Play, Shuffle, ListMusic, Loader2, Trash2, Heart } from 'lucide-react'
import { SongTable } from '../components/SongTable'
import { AddToPlaylistModal } from '../components/AddToPlaylistModal'
import { Cover } from '../components/Cover'
import { usePlayer } from '../contexts/PlayerContext'
import { useLibrary } from '../state/hooks'
import { useRoute, DeskRoute } from '../state/route'
import { getServices } from '../services/runtime'
import { toSongs, durationSeconds, formatTotalDuration } from '../state/songUtils'
import type { Song } from '../services/models'

const FAVORITES_ID = 'favorites'

interface ResolvedPlaylist {
  id: string
  name: string
  coverUrl: string | null
  songs: Song[]
  /** 自建歌单才允许增删（远端歌单是只读的） */
  editable: boolean
  /** 远端来源标识（bilibili / netease / …）；收藏时一并存进库里 */
  source: string
  sourceLabel: string
}

export function PlaylistDetailView() {
  const route = useRoute()
  const player = usePlayer()
  const library = useLibrary()
  const [addTarget, setAddTarget] = useState<Song | null>(null)
  const [remote, setRemote] = useState<ResolvedPlaylist | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collectBusy, setCollectBusy] = useState(false)

  const playlistId = route.playlistId ?? ''

  const localPlaylist = useMemo(
    () => library.userPlaylists.find((p) => p['id']?.toString() === playlistId) ?? null,
    [library.userPlaylists, playlistId],
  )

  // 远端歌单在本地库里找不到时才去取；我喜欢的音乐直接从 library.likedSongs 派生
  // （放在 resolved memo 里），避免每次点赞/取消点赞都重跑 effect 导致列表闪一下。
  useEffect(() => {
    if (playlistId === '' || playlistId === FAVORITES_ID || localPlaylist != null) {
      setRemote(null)
      setError(null)
      setLoading(false)
      return
    }

    let alive = true
    setLoading(true)
    setError(null)
    setRemote(null)

    const finish = (next: ResolvedPlaylist | null, message: string | null) => {
      if (!alive) return
      setRemote(next)
      setError(message)
      setLoading(false)
    }

    void (async () => {
      try {
        const resolved = await getServices().music.getPlaylist(playlistId)
        const rawSongs = resolved['songs']
        finish(
          {
            id: playlistId,
            name: resolved['title']?.toString() || '歌单',
            coverUrl: resolved['coverUrl']?.toString() || null,
            songs: Array.isArray(rawSongs)
              ? toSongs(rawSongs as Record<string, unknown>[])
              : [],
            editable: false,
            source: resolved['source']?.toString() ?? '',
            sourceLabel: resolved['sourceLabel']?.toString() ?? '',
          },
          null,
        )
      } catch (e) {
        finish(null, e instanceof Error ? e.message : String(e))
      }
    })()

    return () => {
      alive = false
    }
  }, [playlistId, localPlaylist])

  const resolved = useMemo<ResolvedPlaylist | null>(() => {
    if (playlistId === FAVORITES_ID) {
      return {
        id: FAVORITES_ID,
        name: '我喜欢的音乐',
        coverUrl: null,
        songs: library.likedSongs,
        editable: false,
        source: '',
        sourceLabel: '',
      }
    }
    if (localPlaylist != null) {
      const rawSongs = localPlaylist['songs']
      return {
        id: localPlaylist['id']?.toString() ?? '',
        name: localPlaylist['name']?.toString() || '未命名歌单',
        coverUrl: localPlaylist['coverUrl']?.toString() || null,
        songs: Array.isArray(rawSongs) ? toSongs(rawSongs as Record<string, unknown>[]) : [],
        // 服务端同步/收藏来的歌单不应提供「删除/增删歌曲」（会去改远端别人的歌单）
        editable: localPlaylist['isCollected'] !== true,
        source: localPlaylist['source']?.toString() ?? '',
        sourceLabel: localPlaylist['sourceLabel']?.toString() ?? '',
      }
    }
    return remote
  }, [localPlaylist, remote, playlistId, library.likedSongs])

  if (loading && resolved == null) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Loader2 size={28} strokeWidth={1.5} className="animate-spin text-[#C7C7CC]" />
        <p className="mt-3 text-[14px] text-[#86868B]">正在载入歌单…</p>
      </div>
    )
  }

  if (resolved == null) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ListMusic size={40} strokeWidth={1.25} className="text-[#C7C7CC]" />
        <p className="mt-3 text-[14px] text-[#86868B]">
          {error != null ? `歌单载入失败：${error}` : '歌单不存在或已被删除'}
        </p>
      </div>
    )
  }

  const { id, name, coverUrl: cover, songs, editable, source, sourceLabel } = resolved
  const totalSeconds = songs.reduce((sum, s) => sum + durationSeconds(s), 0)
  // 收藏态：本地库里已有同 id 且标记 isCollected（收藏的歌单详情走本地快照分支）
  const collected = localPlaylist != null && localPlaylist['isCollected'] === true
  const selfCreated = localPlaylist != null && localPlaylist['isCollected'] !== true
  const canCollect = playlistId !== FAVORITES_ID && !selfCreated

  /** 收藏 / 取消收藏（collectPlaylist 本身是 toggle；失败由服务层回滚本地状态） */
  const toggleCollect = async () => {
    if (collectBusy) return
    setCollectBusy(true)
    try {
      await library.collectPlaylist({
        id,
        name,
        title: name,
        ...(cover != null ? { coverUrl: cover } : {}),
        songs: songs.map((s) => s.extra),
        songCount: songs.length,
        resultType: 'playlist',
        ...(source !== '' ? { source, sourceLabel } : {}),
      })
    } catch (e) {
      // 项目里没有全局 toast；写库依赖云端（未登录会 401），失败必须让用户知道
      window.alert(`收藏失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setCollectBusy(false)
    }
  }

  const playAll = (shuffle: boolean) => {
    if (songs.length === 0) return
    const queue = songs.map((s) => s.extra)
    const index = shuffle ? Math.floor(Math.random() * songs.length) : 0
    player.playSong(queue[index], queue)
  }

  return (
    <div className="space-y-7">
      <div className="flex items-end gap-7">
        {cover != null ? (
          <Cover src={cover} size={192} radius="rounded-xl" className="shadow-[0_12px_36px_rgba(0,0,0,0.16)]" iconSize={48} seed={name} />
        ) : (
          <div className="flex h-[192px] w-[192px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#F5F5F7] to-[#E5E5EA] shadow-[0_12px_36px_rgba(0,0,0,0.08)]">
            <ListMusic size={64} strokeWidth={1.25} className="text-[#C7C7CC]" />
          </div>
        )}
        <div className="pb-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#86868B]">
            {editable ? 'Playlist' : 'Collection'}
          </div>
          <h1
            data-playlist-title
            className="mt-1 max-w-[620px] text-[40px] font-bold leading-tight tracking-tight text-[#1D1D1F]"
          >
            {name}
          </h1>
          <div className="mt-2 text-[13px] text-[#86868B]">
            {songs.length} 首歌曲
            {totalSeconds > 0 ? ` · ${formatTotalDuration(totalSeconds)}` : ''}
          </div>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              disabled={songs.length === 0}
              onClick={() => playAll(false)}
              className="flex items-center gap-2 rounded-full bg-[#FA233B] px-5 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-[#E01E34] disabled:opacity-40"
            >
              <Play size={15} strokeWidth={2} fill="currentColor" />
              播放全部
            </button>
            <button
              type="button"
              disabled={songs.length === 0}
              onClick={() => playAll(true)}
              className="flex items-center gap-2 rounded-full bg-[#F5F5F7] px-5 py-2 text-[13.5px] font-medium text-[#FA233B] transition-colors hover:bg-black/[0.07] disabled:opacity-40"
            >
              <Shuffle size={15} strokeWidth={2} />
              随机播放
            </button>
            {canCollect && (
              <button
                type="button"
                data-testid="playlist-collect"
                data-collected={collected ? 'true' : 'false'}
                disabled={collectBusy}
                onClick={() => void toggleCollect()}
                className={`flex items-center gap-2 rounded-full px-5 py-2 text-[13.5px] font-medium transition-colors disabled:opacity-50 ${
                  collected
                    ? 'bg-[#FA233B] text-white hover:bg-[#E01E34]'
                    : 'bg-[#F5F5F7] text-[#FA233B] hover:bg-black/[0.07]'
                }`}
              >
                {collectBusy ? (
                  <Loader2 size={15} strokeWidth={2} className="animate-spin" />
                ) : (
                  <Heart size={15} strokeWidth={2} fill={collected ? 'currentColor' : 'none'} />
                )}
                {collected ? '已收藏' : '收藏歌单'}
              </button>
            )}
            {editable && (
              <button
                type="button"
                aria-label="删除歌单"
                onClick={() => {
                  if (window.confirm(`删除歌单「${name}」？此操作不可恢复。`)) {
                    void library.deletePlaylist(id).then(() => route.go(DeskRoute.Library))
                  }
                }}
                className="flex items-center gap-2 rounded-full bg-[#F5F5F7] px-5 py-2 text-[13.5px] font-medium text-[#86868B] transition-colors hover:bg-[#FA233B]/10 hover:text-[#FA233B]"
              >
                <Trash2 size={15} strokeWidth={2} />
                删除歌单
              </button>
            )}
          </div>
        </div>
      </div>

      <SongTable
        songs={songs}
        onPlay={(song) => {
          const queue = songs.map((s) => s.extra)
          const index = songs.findIndex((s) => s.id === song.id)
          player.playSong(queue[index >= 0 ? index : 0], queue)
        }}
        onAddToPlaylist={editable ? (song) => setAddTarget(song) : undefined}
        onRemove={editable ? (song) => void library.removeSongsFromPlaylist(id, new Set([song.id])) : undefined}
        removeLabel="从歌单移除"
        emptyText={editable ? '歌单还是空的 —— 在歌曲上点「…→ 添加到歌单」' : '这个合集没有可播放的曲目'}
      />

      <AddToPlaylistModal song={addTarget} open={addTarget != null} onClose={() => setAddTarget(null)} />
    </div>
  )
}
