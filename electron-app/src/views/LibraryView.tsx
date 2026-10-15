/**
 * 我的音乐 —— 对应 Flutter DesktopLibraryScreen：
 * 四个标签页（我喜欢的音乐 / 我的歌单 / 播放历史 / 离线缓存）。
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Heart,
  ListMusic,
  Clock,
  HardDrive,
  Play,
  Shuffle,
  Trash2,
  ChevronRight,
} from 'lucide-react'
import { SongTable } from '../components/SongTable'
import { AddToPlaylistModal } from '../components/AddToPlaylistModal'
import { Cover } from '../components/Cover'
import { usePlayer } from '../contexts/PlayerContext'
import { useLibrary } from '../state/hooks'
import { DeskRoute, useRoute } from '../state/route'
import { durationSeconds, formatTotalDuration } from '../state/songUtils'
import { formatBytes } from '../state/format'
import type { Song } from '../services/models'

type TabId = 'liked' | 'playlists' | 'history' | 'offline'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'liked', label: '我喜欢的音乐', icon: <Heart size={14} strokeWidth={1.75} /> },
  { id: 'playlists', label: '我的歌单', icon: <ListMusic size={14} strokeWidth={1.75} /> },
  { id: 'history', label: '播放历史', icon: <Clock size={14} strokeWidth={1.75} /> },
  { id: 'offline', label: '离线缓存', icon: <HardDrive size={14} strokeWidth={1.75} /> },
]

/** 离线缓存面板：统计来自主进程 audioCache（目录/清理都在主进程） */
function OfflinePanel() {
  const [stats, setStats] = useState<{ fileCount: number; totalBytes: number; directory: string } | null>(
    null,
  )
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const api = window.imusicAPI
    if (api == null) return
    try {
      setStats(await api.cacheStats())
    } catch (e) {
      setNote(`读取缓存信息失败：${String(e)}`)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const clear = async () => {
    const api = window.imusicAPI
    if (api == null || busy) return
    setBusy(true)
    try {
      const result = await api.cacheClear()
      setNote(`已清理 ${result.removed} 个文件，释放 ${formatBytes(result.freedBytes)}`)
      await refresh()
    } catch (e) {
      setNote(`清理失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="library-offline" className="space-y-5">
      <div className="rounded-2xl border border-[#E5E5EA] bg-white/70 p-7">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-[#1D1D1F]">离线缓存</h2>
            <p className="mt-1.5 text-[13px] text-[#86868B]">
              B 站等需要请求头的音源会整首落盘后再播放；直链音源（netease/直链 API）不落盘。
            </p>
          </div>
          <HardDrive size={34} strokeWidth={1.25} className="text-[#FA233B]" />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="rounded-xl bg-[#F5F5F7]/70 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#86868B]">缓存文件</div>
            <div data-testid="offline-file-count" className="mt-1 text-[22px] font-semibold tabular-nums text-[#1D1D1F]">
              {stats?.fileCount ?? '—'}
            </div>
          </div>
          <div className="rounded-xl bg-[#F5F5F7]/70 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#86868B]">占用空间</div>
            <div data-testid="offline-total-bytes" className="mt-1 text-[22px] font-semibold tabular-nums text-[#1D1D1F]">
              {stats != null ? formatBytes(stats.totalBytes) : '—'}
            </div>
          </div>
        </div>

        <div className="mt-4 truncate text-[12px] text-[#86868B]" title={stats?.directory ?? ''}>
          缓存目录：{stats?.directory ?? '读取中…'}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            disabled={busy || (stats?.fileCount ?? 0) === 0}
            onClick={() => void clear()}
            className="flex items-center gap-2 rounded-full bg-[#F5F5F7] px-4 py-2 text-[13px] text-[#86868B] transition-colors hover:bg-black/[0.07] hover:text-[#FA233B] disabled:opacity-40"
          >
            <Trash2 size={14} strokeWidth={1.75} />
            清空缓存
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-full px-4 py-2 text-[13px] text-[#86868B] transition-colors hover:bg-black/[0.05]"
          >
            刷新
          </button>
          {note != null && <span className="text-[12px] text-[#86868B]">{note}</span>}
        </div>
      </div>
    </div>
  )
}

export function LibraryView() {
  const player = usePlayer()
  const library = useLibrary()
  const route = useRoute()
  const [tab, setTab] = useState<TabId>('liked')
  const [addTarget, setAddTarget] = useState<Song | null>(null)

  const liked = library.likedSongs
  const history = library.history
  const playlists = library.userPlaylists
  const totalSeconds = liked.reduce((sum, s) => sum + durationSeconds(s), 0)

  const playQueue = (songs: Song[], index: number) => {
    if (songs.length === 0) return
    const queue = songs.map((s) => s.extra)
    player.playSong(queue[index >= 0 ? index : 0], queue)
  }

  return (
    <div className="space-y-6" data-testid="library-view">
      {/* 标题 */}
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#86868B]">
            Library
          </div>
          <h1 className="mt-1 text-[32px] font-bold leading-tight tracking-tight text-[#1D1D1F]">
            我的音乐
          </h1>
          <p className="mt-1 text-[13px] text-[#86868B]">
            {liked.length} 首喜欢 · {playlists.length} 个歌单 · {history.length} 条播放记录
            {library.isLoading ? ' · 同步中…' : ''}
          </p>
        </div>
        {tab === 'liked' && (
          <div className="flex gap-3">
            <button
              type="button"
              disabled={liked.length === 0}
              onClick={() => playQueue(liked, 0)}
              className="flex items-center gap-2 rounded-full bg-[#FA233B] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#E01E34] disabled:opacity-40"
            >
              <Play size={14} strokeWidth={2} fill="currentColor" />
              播放全部
            </button>
            <button
              type="button"
              disabled={liked.length === 0}
              onClick={() => playQueue(liked, Math.floor(Math.random() * liked.length))}
              className="flex items-center gap-2 rounded-full bg-[#F5F5F7] px-4 py-2 text-[13px] font-medium text-[#FA233B] transition-colors hover:bg-black/[0.07] disabled:opacity-40"
            >
              <Shuffle size={14} strokeWidth={2} />
              随机
            </button>
          </div>
        )}
      </div>

      {/* 标签页 */}
      <div className="flex gap-1 border-b border-[#E5E5EA]" role="tablist">
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`library-tab-${t.id}`}
              data-active={active ? 'true' : 'false'}
              onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-[13.5px] transition-colors ${
                active ? 'font-medium text-[#FA233B]' : 'text-[#86868B] hover:text-[#1D1D1F]'
              }`}
            >
              {t.icon}
              {t.label}
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[#FA233B]" />
              )}
            </button>
          )
        })}
      </div>

      {tab === 'liked' && (
        <div data-testid="library-liked" className="space-y-4">
          <div className="text-[13px] text-[#86868B]">
            {liked.length} 首歌曲
            {totalSeconds > 0 ? ` · ${formatTotalDuration(totalSeconds)}` : ''}
          </div>
          <SongTable
            songs={liked}
            onPlay={(song) => playQueue(liked, liked.findIndex((s) => s.id === song.id))}
            onAddToPlaylist={(song) => setAddTarget(song)}
            onRemove={(song) => void library.toggleLike(song)}
            removeLabel="取消喜欢"
            emptyText="还没有喜欢的歌曲 —— 在任意歌曲上点 ♥ 即可收藏"
          />
        </div>
      )}

      {tab === 'playlists' && (
        <div data-testid="library-playlists">
          {playlists.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-[#86868B]">
              还没有歌单 —— 在左侧「创建的歌单」点 + 新建
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
              {playlists.map((pl) => {
                const id = pl['id']?.toString() ?? ''
                const name = pl['name']?.toString() ?? pl['title']?.toString() ?? '未命名歌单'
                const cover = pl['coverUrl']?.toString() ?? null
                const songs = Array.isArray(pl['songs']) ? (pl['songs'] as unknown[]).length : 0
                const collected = pl['isCollected'] === true
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => route.go(DeskRoute.PlaylistDetail, { playlistId: id })}
                    className="group flex items-center gap-4 rounded-2xl border border-[#E5E5EA] bg-white/70 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(0,0,0,0.08)]"
                  >
                    {cover != null ? (
                      <Cover src={cover} size={56} radius="rounded-xl" iconSize={18} seed={name} />
                    ) : (
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#FA233B]/10 text-[#FA233B]">
                        {collected ? <Heart size={20} strokeWidth={1.75} /> : <ListMusic size={20} strokeWidth={1.75} />}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-[#1D1D1F]">{name}</div>
                      <div className="mt-1 text-[12px] text-[#86868B]">
                        {collected ? '收藏的' : '创建的'} · {songs} 首
                      </div>
                    </div>
                    <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-[#C7C7CC] group-hover:text-[#86868B]" />
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div data-testid="library-history" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-[13px] text-[#86868B]">共 {history.length} 首</div>
            <button
              type="button"
              disabled={history.length === 0}
              onClick={() => void library.clearHistory()}
              className="flex items-center gap-2 rounded-full bg-[#F5F5F7] px-4 py-1.5 text-[12.5px] text-[#86868B] transition-colors hover:bg-black/[0.07] hover:text-[#FA233B] disabled:opacity-40"
            >
              <Trash2 size={13} strokeWidth={1.75} />
              清空历史
            </button>
          </div>
          <SongTable
            songs={history}
            showAlbum={false}
            onPlay={(song) => playQueue(history, history.findIndex((s) => s.id === song.id))}
            onAddToPlaylist={(song) => setAddTarget(song)}
            emptyText="暂无播放记录"
          />
        </div>
      )}

      {tab === 'offline' && <OfflinePanel />}

      <AddToPlaylistModal song={addTarget} open={addTarget != null} onClose={() => setAddTarget(null)} />
    </div>
  )
}
