/** 历史播放 —— 总数统计 + 清空历史 + 极简歌曲表格 */

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { SongTable } from '../components/SongTable'
import { AddToPlaylistModal } from '../components/AddToPlaylistModal'
import { usePlayer } from '../contexts/PlayerContext'
import { useLibrary } from '../state/hooks'
import type { Song } from '../services/models'

export function HistoryView() {
  const player = usePlayer()
  const library = useLibrary()
  const songs = library.history
  const [addTarget, setAddTarget] = useState<Song | null>(null)

  return (
    <div className="space-y-7">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">历史播放</h1>
          <p className="mt-1.5 text-[13px] text-secondary">
            共 {songs.length} 首{library.isLoading ? ' · 同步中…' : ''}
          </p>
        </div>
        <button
          type="button"
          disabled={songs.length === 0}
          onClick={() => void library.clearHistory()}
          className="flex items-center gap-2 rounded-full bg-fill px-4 py-2 text-[13px] text-secondary transition-colors hover:bg-hover hover:text-accent disabled:opacity-40"
        >
          <Trash2 size={14} strokeWidth={1.75} />
          清空历史
        </button>
      </div>

      <SongTable
        songs={songs}
        showAlbum={false}
        onPlay={(song) => {
          const queue = songs.map((s) => s.extra)
          const index = songs.findIndex((s) => s.id === song.id)
          player.playSong(queue[index >= 0 ? index : 0], queue)
        }}
        onAddToPlaylist={(song) => setAddTarget(song)}
        emptyText="暂无播放记录"
      />

      <AddToPlaylistModal song={addTarget} open={addTarget != null} onClose={() => setAddTarget(null)} />
    </div>
  )
}
