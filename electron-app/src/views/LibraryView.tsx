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
  Download,
  Play,
  Shuffle,
  Trash2,
  ChevronRight,
} from 'lucide-react'
import { SongTable } from '../components/SongTable'
import { AddToPlaylistModal } from '../components/AddToPlaylistModal'
import { Cover } from '../components/Cover'
import { usePlayer } from '../contexts/PlayerContext'
import { useAuth, useLibrary } from '../state/hooks'
import { toggleLikeGuarded } from '../state/likeAction'
import { DeskRoute, useRoute } from '../state/route'
import { durationSeconds, formatTotalDuration, playlistCover } from '../state/songUtils'
import { formatBytes } from '../state/format'
import { cacheSongsSequentially } from '../state/offlineCache'
import type { Song } from '../services/models'

type TabId = 'liked' | 'playlists' | 'history' | 'offline'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'liked', label: '我喜欢的音乐', icon: <Heart size={14} strokeWidth={1.75} /> },
  { id: 'playlists', label: '我的歌单', icon: <ListMusic size={14} strokeWidth={1.75} /> },
  { id: 'history', label: '播放历史', icon: <Clock size={14} strokeWidth={1.75} /> },
  { id: 'offline', label: '离线缓存', icon: <HardDrive size={14} strokeWidth={1.75} /> },
]

/** 离线缓存面板：统计/列表/删除/批量下载都走主进程 audioCache */
function OfflinePanel() {
  const library = useLibrary()
  const liked = library.likedSongs
  const [stats, setStats] = useState<{ fileCount: number; totalBytes: number; directory: string } | null>(
    null,
  )
  const [tracks, setTracks] = useState<CachedTrack[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 批量缓存进度：done 为当前正在处理第几首（1 起），null 表示未在缓存 */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const refresh = useCallback(async () => {
    const api = window.imusicAPI
    if (api == null) return
    try {
      const [nextStats, nextTracks] = await Promise.all([api.cacheStats(), api.cacheList()])
      setStats(nextStats)
      setTracks(nextTracks)
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

  const remove = async (id: string) => {
    const api = window.imusicAPI
    if (api == null || busy) return
    setBusy(true)
    try {
      await api.cacheRemove(id)
      await refresh()
    } catch (e) {
      setNote(`删除失败：${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 把我喜欢的音乐整批缓存到本地（串行，单首失败不中断） */
  const cacheLiked = async () => {
    const api = window.imusicAPI
    if (api == null || busy || liked.length === 0) return
    setBusy(true)
    setNote(null)
    setProgress({ done: 1, total: liked.length })
    try {
      const result = await cacheSongsSequentially(liked, (done, total) => {
        setProgress({ done: done + 1, total })
      })
      const sample = result.failed
        .slice(0, 2)
        .map((f) => f.song.title)
        .join('、')
      setNote(
        `缓存完成：成功 ${result.ok} 首` +
          (result.failed.length > 0 ? `，失败 ${result.failed.length} 首（如：${sample}）` : ''),
      )
      await refresh()
    } catch (e) {
      setNote(`缓存失败：${String(e)}`)
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  /** 按钮文案：缓存进度 > 空列表 > 默认（用平铺 if/else，避免嵌套三元） */
  let cacheLabel = '缓存我喜欢的音乐'
  if (progress != null) {
    cacheLabel = `缓存中 ${progress.done}/${progress.total}`
  } else if (liked.length === 0) {
    cacheLabel = '我喜欢的音乐为空'
  }

  return (
    <div data-testid="library-offline" className="space-y-5">
      <div className="rounded-2xl border border-subtle bg-card/70 p-7">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-primary">离线缓存</h2>
            <p className="mt-1.5 text-[13px] text-secondary">
              缓存的歌曲保存在本地，播放时优先使用本地文件，断网也能听。
            </p>
          </div>
          <HardDrive size={34} strokeWidth={1.25} className="text-accent" />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="rounded-xl bg-fill/70 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary">缓存文件</div>
            <div data-testid="offline-file-count" className="mt-1 text-[22px] font-semibold tabular-nums text-primary">
              {stats?.fileCount ?? '—'}
            </div>
          </div>
          <div className="rounded-xl bg-fill/70 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary">占用空间</div>
            <div data-testid="offline-total-bytes" className="mt-1 text-[22px] font-semibold tabular-nums text-primary">
              {stats != null ? formatBytes(stats.totalBytes) : '—'}
            </div>
          </div>
        </div>

        <div className="mt-4 truncate text-[12px] text-secondary" title={stats?.directory ?? ''}>
          缓存目录：{stats?.directory ?? '读取中…'}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            data-testid="offline-cache-liked"
            disabled={busy || liked.length === 0}
            onClick={() => void cacheLiked()}
            className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            <Download size={14} strokeWidth={1.75} />
            {cacheLabel}
          </button>
          <button
            type="button"
            disabled={busy || (stats?.fileCount ?? 0) === 0}
            onClick={() => void clear()}
            className="flex items-center gap-2 rounded-full bg-fill px-4 py-2 text-[13px] text-secondary transition-colors hover:bg-hover hover:text-accent disabled:opacity-40"
          >
            <Trash2 size={14} strokeWidth={1.75} />
            清空缓存
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-full px-4 py-2 text-[13px] text-secondary transition-colors hover:bg-hover"
          >
            刷新
          </button>
          {note != null && <span className="text-[12px] text-secondary">{note}</span>}
        </div>
      </div>

      {/* 已缓存歌曲列表 */}
      <div className="rounded-2xl border border-subtle bg-card/70 p-7">
        <h3 className="text-[15px] font-semibold text-primary">已缓存歌曲</h3>
        {tracks.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-secondary">还没有缓存任何歌曲</div>
        ) : (
          <div data-testid="offline-song-list" className="mt-4 divide-y divide-subtle">
            {tracks.map((track) => (
              <div
                key={track.id}
                data-testid="offline-song-row"
                className="flex items-center gap-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium text-primary" title={track.title}>
                    {track.title}
                  </div>
                  <div className="truncate text-[12px] text-secondary" title={track.artist}>
                    {track.artist}
                  </div>
                </div>
                <span className="shrink-0 rounded bg-fill px-1.5 py-0.5 text-[10px] text-secondary">
                  {track.source}
                </span>
                <span className="w-[74px] shrink-0 text-right text-[12px] tabular-nums text-secondary">
                  {formatBytes(track.bytes)}
                </span>
                <span className="hidden w-[90px] shrink-0 text-right text-[12px] text-secondary sm:block">
                  {new Date(track.cachedAt).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  data-testid="offline-song-remove"
                  disabled={busy}
                  onClick={() => void remove(track.id)}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-fill px-2.5 py-1 text-[12px] text-secondary transition-colors hover:bg-hover hover:text-accent disabled:opacity-40"
                >
                  <Trash2 size={12} strokeWidth={1.75} />
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function LibraryView() {
  const player = usePlayer()
  const library = useLibrary()
  const auth = useAuth()
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
          <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
            Library
          </div>
          <h1 className="mt-1 text-[32px] font-bold leading-tight tracking-tight text-primary">
            我的音乐
          </h1>
          <p className="mt-1 text-[13px] text-secondary">
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
              className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              <Play size={14} strokeWidth={2} fill="currentColor" />
              播放全部
            </button>
            <button
              type="button"
              disabled={liked.length === 0}
              onClick={() => playQueue(liked, Math.floor(Math.random() * liked.length))}
              className="flex items-center gap-2 rounded-full bg-fill px-4 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-hover disabled:opacity-40"
            >
              <Shuffle size={14} strokeWidth={2} />
              随机
            </button>
          </div>
        )}
      </div>

      {/* 标签页 */}
      <div className="flex gap-1 border-b border-subtle" role="tablist">
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
                active ? 'font-medium text-accent' : 'text-secondary hover:text-primary'
              }`}
            >
              {t.icon}
              {t.label}
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent" />
              )}
            </button>
          )
        })}
      </div>

      {tab === 'liked' && (
        <div data-testid="library-liked" className="space-y-4">
          <div className="text-[13px] text-secondary">
            {liked.length} 首歌曲
            {totalSeconds > 0 ? ` · ${formatTotalDuration(totalSeconds)}` : ''}
          </div>
          <SongTable
            songs={liked}
            onPlay={(song) => playQueue(liked, liked.findIndex((s) => s.id === song.id))}
            onAddToPlaylist={(song) => setAddTarget(song)}
            onRemove={(song) => toggleLikeGuarded(auth, library, song)}
            removeLabel="取消喜欢"
            emptyText="还没有喜欢的歌曲 —— 在任意歌曲上点 ♥ 即可收藏"
          />
        </div>
      )}

      {tab === 'playlists' && (
        <div data-testid="library-playlists">
          {playlists.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-secondary">
              还没有歌单 —— 在左侧「创建的歌单」点 + 新建
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
              {playlists.map((pl) => {
                const id = pl['id']?.toString() ?? ''
                const name = pl['name']?.toString() ?? pl['title']?.toString() ?? '未命名歌单'
                const cover = playlistCover(pl)
                const songs = Array.isArray(pl['songs']) ? (pl['songs'] as unknown[]).length : 0
                const collected = pl['isCollected'] === true
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => route.go(DeskRoute.PlaylistDetail, { playlistId: id })}
                    className="group flex items-center gap-4 rounded-2xl border border-subtle bg-card/70 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(0,0,0,0.08)]"
                  >
                    <Cover src={cover} size={56} radius="rounded-xl" iconSize={18} seed={id !== '' ? id : name} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-primary">{name}</div>
                      <div className="mt-1 text-[12px] text-secondary">
                        {collected ? '收藏的' : '创建的'} · {songs} 首
                      </div>
                    </div>
                    <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-secondary group-hover:text-secondary" />
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
            <div className="text-[13px] text-secondary">共 {history.length} 首</div>
            <button
              type="button"
              disabled={history.length === 0}
              onClick={() => void library.clearHistory()}
              className="flex items-center gap-2 rounded-full bg-fill px-4 py-1.5 text-[12.5px] text-secondary transition-colors hover:bg-hover hover:text-accent disabled:opacity-40"
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
