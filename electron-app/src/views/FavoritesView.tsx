/** 我喜欢的音乐 —— 珊瑚红渐变爱心封面 + 播放全部/随机播放 + 歌曲表格 */

import { useState } from 'react'
import { Play, Shuffle, Heart } from 'lucide-react'
import { SongTable } from '../components/SongTable'
import { AddToPlaylistModal } from '../components/AddToPlaylistModal'
import { usePlayer } from '../contexts/PlayerContext'
import { useAuth, useLibrary } from '../state/hooks'
import { toggleLikeGuarded } from '../state/likeAction'
import { durationSeconds, formatTotalDuration } from '../state/songUtils'
import type { Song } from '../services/models'

export function FavoritesView() {
  const player = usePlayer()
  const library = useLibrary()
  const auth = useAuth()
  const songs = library.likedSongs
  const [addTarget, setAddTarget] = useState<Song | null>(null)

  const totalSeconds = songs.reduce((sum, s) => sum + durationSeconds(s), 0)

  const playAll = (shuffle: boolean) => {
    if (songs.length === 0) return
    const queue = songs.map((s) => s.extra)
    const index = shuffle ? Math.floor(Math.random() * songs.length) : 0
    player.playSong(queue[index], queue)
  }

  return (
    <div className="space-y-7">
      {/* 头部 */}
      <div className="flex items-end gap-7">
        <div className="flex h-[192px] w-[192px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-[#FF7A59] shadow-[0_12px_36px_rgba(250,35,59,0.28)]">
          <Heart size={72} strokeWidth={1.5} fill="white" className="text-white" />
        </div>
        <div className="pb-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
            Playlist
          </div>
          <h1 className="mt-1 text-[40px] font-bold leading-tight tracking-tight text-primary">
            我喜欢的音乐
          </h1>
          <div className="mt-2 text-[13px] text-secondary">
            {songs.length} 首歌曲
            {totalSeconds > 0 ? ` · ${formatTotalDuration(totalSeconds)}` : ''}
          </div>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              disabled={songs.length === 0}
              onClick={() => playAll(false)}
              className="flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              <Play size={15} strokeWidth={2} fill="currentColor" />
              播放全部
            </button>
            <button
              type="button"
              disabled={songs.length === 0}
              onClick={() => playAll(true)}
              className="flex items-center gap-2 rounded-full bg-fill px-5 py-2 text-[13.5px] font-medium text-accent transition-colors hover:bg-hover disabled:opacity-40"
            >
              <Shuffle size={15} strokeWidth={2} />
              随机播放
            </button>
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
        onAddToPlaylist={(song) => setAddTarget(song)}
        onRemove={(song) => toggleLikeGuarded(auth, library, song)}
        removeLabel="取消喜欢"
        emptyText="还没有喜欢的歌曲 —— 在任意歌曲上点 ♥ 即可收藏"
      />

      <AddToPlaylistModal song={addTarget} open={addTarget != null} onClose={() => setAddTarget(null)} />
    </div>
  )
}
