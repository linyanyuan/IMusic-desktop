/** 加入自建歌单弹窗 —— 供歌曲表格「更多 → 添加到歌单」调用 */

import { Modal } from './Modal'
import { Cover } from './Cover'
import { ListMusic, Plus } from 'lucide-react'
import { useLibrary } from '../state/hooks'
import { useState } from 'react'
import type { Song } from '../services/models'

export function AddToPlaylistModal({
  song,
  open,
  onClose,
}: {
  song: Song | null
  open: boolean
  onClose: () => void
}) {
  const library = useLibrary()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setDone(null)
    setCreating(false)
    setName('')
    setError(null)
    onClose()
  }

  const addTo = async (playlistId: string, playlistName: string) => {
    if (song == null || busy) return
    setBusy(true)
    setError(null)
    try {
      await library.addSongToPlaylist(playlistId, song)
      setDone(playlistName)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const createAndAdd = async () => {
    const trimmed = name.trim()
    if (trimmed === '' || song == null || busy) return
    setBusy(true)
    setError(null)
    try {
      // 用 createPlaylist 的返回值拿新建歌单的 id，而不是回读（异步 state 尚未更新时的）userPlaylists
      const created = await library.createPlaylist(trimmed)
      const id = created['id']?.toString() ?? ''
      if (id !== '') await library.addSongToPlaylist(id, song)
      setDone(trimmed)
      setCreating(false)
      setName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="添加到歌单" onClose={close}>
      {song != null && (
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-[#F5F5F7] p-2.5">
          <Cover src={song.coverUrl} size={36} radius="rounded-lg" iconSize={14} seed={song.title} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-[#1D1D1F]">{song.title}</div>
            <div className="truncate text-[12px] text-[#86868B]">{song.artist}</div>
          </div>
        </div>
      )}

      {done != null && (
        <div className="mb-3 rounded-lg bg-[#FA233B]/[0.07] px-3 py-2 text-[12.5px] text-[#FA233B]">
          已添加到「{done}」
        </div>
      )}

      {error != null && (
        <div className="mb-3 rounded-lg bg-[#FA233B]/[0.07] px-3 py-2 text-[12.5px] text-[#FA233B]">
          操作失败：{error}
        </div>
      )}

      {creating ? (
        <div>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createAndAdd()
            }}
            placeholder="新歌单名称"
            className="w-full rounded-lg border border-[#E5E5EA] px-3 py-2 text-[13.5px] outline-none focus:border-[#FA233B]/40"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-lg px-3 py-1.5 text-[13px] text-[#86868B] hover:bg-black/5"
            >
              返回
            </button>
            <button
              type="button"
              disabled={name.trim() === '' || busy}
              onClick={() => void createAndAdd()}
              className="rounded-lg bg-[#FA233B] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#E01E34] disabled:opacity-40"
            >
              {busy ? '处理中…' : '创建并添加'}
            </button>
          </div>
        </div>
      ) : (
        <div className="max-h-[280px] space-y-0.5 overflow-y-auto">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] text-[#FA233B] transition-colors hover:bg-[#FA233B]/[0.07]"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#FA233B]/10">
              <Plus size={14} strokeWidth={2} />
            </span>
            新建歌单
          </button>
          {library.userPlaylists.length === 0 && (
            <p className="px-3 py-2 text-[12.5px] text-[#86868B]">还没有自建歌单</p>
          )}
          {library.userPlaylists.map((pl, index) => {
            const id = pl['id']?.toString() ?? ''
            const name = pl['name']?.toString() ?? '未命名歌单'
            return (
              <button
                key={id !== '' ? id : `${name}-${index}`}
                type="button"
                disabled={busy}
                onClick={() => void addTo(id, name)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] text-[#1D1D1F] transition-colors hover:bg-[#F5F5F7] disabled:opacity-50"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-black/[0.05] text-[#86868B]">
                  <ListMusic size={14} strokeWidth={1.75} />
                </span>
                <span className="truncate">{name}</span>
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
