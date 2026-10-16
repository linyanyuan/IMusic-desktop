/**
 * 极简歌曲表格 —— 收藏/歌单详情/历史共用。
 * 列：#序号或播放动效、封面+标题、歌手、专辑、喜欢、时长（+可选相对时间）
 */

import { useState } from 'react'
import { Heart, Play, Pause, MoreHorizontal, Trash2, Download, Loader2 } from 'lucide-react'
import type { Song } from '../services/models'
import { Cover } from './Cover'
import { usePlayer } from '../contexts/PlayerContext'
import { PlayingIndicator } from './PlayingIndicator'
import { useAuth, useLibrary } from '../state/hooks'
import { toggleLikeGuarded } from '../state/likeAction'
import { cacheSong } from '../state/offlineCache'
import { showNotice } from '../state/notice'
import { durationSeconds, formatTime, songCover } from '../state/songUtils'

export interface SongTableProps {
  songs: Song[]
  onPlay: (song: Song, index: number) => void
  showAlbum?: boolean
  /** 相对时间列（历史视图） */
  timeOf?: (song: Song) => string
  /** 右键/更多菜单里的删除（歌单内移除 / 清空历史） */
  onRemove?: (song: Song) => void
  removeLabel?: string
  emptyText?: string
  /** 将歌曲加入自建歌单 */
  onAddToPlaylist?: (song: Song) => void
}

// 最后一列 28px 是「更多」按钮的独立列：不这么做时按钮会挤在时长右侧，
// 把数值往左推、右边缘与表头的「时长」对不齐。
const GRID_WITH_ALBUM = 'grid-cols-[40px_minmax(0,2.4fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_44px_64px_28px]'
const GRID_NO_ALBUM = 'grid-cols-[40px_minmax(0,3fr)_minmax(0,1.6fr)_44px_64px_28px]'

export function SongTable({
  songs,
  onPlay,
  showAlbum = true,
  timeOf,
  onRemove,
  removeLabel = '从歌单移除',
  emptyText = '这里还没有歌曲',
  onAddToPlaylist,
}: SongTableProps) {
  const player = usePlayer()
  const library = useLibrary()
  const auth = useAuth()
  const [menuFor, setMenuFor] = useState<string | null>(null)
  // 单曲缓存的探测状态：只对当前展开的行有效（key 与 menuFor 同款）
  const [cacheProbe, setCacheProbe] = useState<{ key: string; cached: boolean; busy: boolean } | null>(null)

  const currentId = player.currentSong?.['id']?.toString() ?? null
  const grid = showAlbum ? GRID_WITH_ALBUM : GRID_NO_ALBUM
  const canCache = typeof window !== 'undefined' && window.imusicAPI != null
  // 单曲缓存入口和删除/加入歌单共用一个「更多」菜单
  const hasMenu = onRemove != null || onAddToPlaylist != null || canCache

  /** 展开/收起某一行的「更多」菜单，并顺带探测该曲是否已在本地缓存 */
  function openMenu(key: string, song: Song): void {
    if (menuFor === key) {
      setMenuFor(null)
      return
    }
    setMenuFor(key)
    if (!canCache) return
    setCacheProbe({ key, cached: false, busy: true })
    void (async () => {
      let hit: { url: string; bytes: number } | null = null
      try {
        hit = (await window.imusicAPI?.cacheLookup(song.id)) ?? null
      } catch {
        // 探测失败按未缓存处理（点下去缓存会给出真正的错误提示）
        hit = null
      }
      // 只在探测结果仍属于当前展开行时写入，避免快速切换行的竞态
      setCacheProbe(prev => (prev?.key === key ? { key, cached: hit != null, busy: false } : prev))
    })()
  }

  if (songs.length === 0) {
    return (
      <div className="py-16 text-center text-[13px] text-secondary">{emptyText}</div>
    )
  }

  return (
    <div className="pb-2">
      {/* 表头 */}
      <div
        className={`sticky top-0 z-10 grid ${grid} gap-4 border-b border-subtle bg-card/85 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-secondary backdrop-blur-xl`}
      >
        <div className="text-center">#</div>
        <div>标题</div>
        <div>歌手</div>
        {showAlbum && <div>专辑</div>}
        <div className="text-center">
          <Heart size={13} strokeWidth={1.75} className="mx-auto" />
        </div>
        <div className="text-right">{timeOf != null ? '播放时间' : '时长'}</div>
        {/* 「更多」按钮列（始终渲染，保持列宽固定） */}
        <div aria-hidden="true" />
      </div>

      {songs.map((song, index) => {
        const isCurrent = currentId != null && song.id === currentId
        const liked = library.isLiked(song)
        const seconds = durationSeconds(song)

        return (
          <div
            key={`${song.id}-${index}`}
            onDoubleClick={() => onPlay(song, index)}
            className={`group grid ${grid} items-center gap-4 rounded-xl px-3 py-2 transition-colors hover:bg-hover ${isCurrent ? 'bg-accent/[0.06]' : ''}`}
          >
            {/* 序号 / 播放态：正在播放显示跳动音柱，悬停变成暂停（Apple Music 行为） */}
            <div className="flex h-8 items-center justify-center">
              {isCurrent && player.isPlaying ? (
                <button
                  type="button"
                  aria-label="暂停"
                  onClick={() => player.togglePlay()}
                  className="group/cell flex h-full w-full items-center justify-center"
                >
                  <PlayingIndicator size={14} className="group-hover/cell:hidden" />
                  <Pause size={14} strokeWidth={2} className="hidden text-accent group-hover/cell:block" />
                </button>
              ) : (
                <>
                  <span
                    className={`text-[13px] tabular-nums ${isCurrent ? 'text-accent' : 'text-secondary'} group-hover:hidden`}
                  >
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    aria-label="播放"
                    onClick={() => onPlay(song, index)}
                    className="hidden text-primary group-hover:block"
                  >
                    <Play size={14} strokeWidth={2} fill="currentColor" />
                  </button>
                </>
              )}
            </div>

            {/* 封面 + 标题 */}
            <div className="flex min-w-0 items-center gap-3">
              <Cover src={songCover(song)} size={36} radius="rounded-lg" iconSize={14} seed={song.title} />
              <span
                className={`truncate text-[13.5px] font-medium ${isCurrent ? 'text-accent' : 'text-primary'}`}
                title={song.title}
              >
                {song.title}
              </span>
            </div>

            {/* 歌手 */}
            <div className="truncate text-[13px] text-secondary" title={song.artist}>
              {song.artist}
            </div>

            {/* 专辑 */}
            {showAlbum && (
              <div className="truncate text-[13px] text-secondary">
                {song.extra['album']?.toString() ?? '—'}
              </div>
            )}

            {/* 喜欢 */}
            <div className="flex justify-center">
              <button
                type="button"
                aria-label={liked ? '取消喜欢' : '喜欢'}
                onClick={() => toggleLikeGuarded(auth, library, song)}
                className={`transition-transform active:scale-90 ${
                  liked ? 'text-accent' : 'text-secondary opacity-0 group-hover:opacity-100'
                }`}
              >
                <Heart size={15} strokeWidth={1.75} fill={liked ? 'currentColor' : 'none'} />
              </button>
            </div>

            {/* 时长 / 相对时间 */}
            <div className="text-right text-[12.5px] tabular-nums text-secondary">
              {timeOf != null ? timeOf(song) : formatTime(seconds)}
            </div>

            {/* 更多按钮（独立列，右边缘与表头对齐） */}
            <div className="relative flex items-center justify-end">
              {hasMenu && (
                <>
                  <button
                    type="button"
                    aria-label="更多"
                    onClick={() => openMenu(`${song.id}-${index}`, song)}
                    className="rounded-md p-0.5 text-secondary opacity-0 transition-opacity hover:bg-hover group-hover:opacity-100"
                  >
                    <MoreHorizontal size={15} strokeWidth={1.75} />
                  </button>
                  {menuFor === `${song.id}-${index}` && (
                    <>
                      <div
                        className="fixed inset-0 z-20"
                        onClick={() => setMenuFor(null)}
                        aria-hidden="true"
                      />
                      <div className="absolute right-0 top-7 z-30 w-[168px] overflow-hidden rounded-xl border border-subtle bg-card/95 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.12)] backdrop-blur-xl">
                        {onAddToPlaylist != null && (
                          <button
                            type="button"
                            onClick={() => {
                              setMenuFor(null)
                              onAddToPlaylist(song)
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-primary hover:bg-hover"
                          >
                            <MoreHorizontal size={14} strokeWidth={1.75} />
                            添加到歌单
                          </button>
                        )}
                        {canCache && cacheProbe?.key === `${song.id}-${index}` && (
                          <>
                            {cacheProbe.busy ? (
                              <div className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-secondary opacity-60">
                                <Loader2 size={14} className="animate-spin" />
                                读取缓存状态…
                              </div>
                            ) : cacheProbe.cached ? (
                              <button
                                type="button"
                                data-testid="song-cache-remove"
                                onClick={() => {
                                  const key = `${song.id}-${index}`
                                  setMenuFor(null)
                                  setCacheProbe({ key, cached: true, busy: true })
                                  void (async () => {
                                    try {
                                      await window.imusicAPI?.cacheRemove(song.id)
                                      setCacheProbe({ key, cached: false, busy: false })
                                      showNotice(`已删除《${song.title}》的本地缓存`)
                                    } catch (e) {
                                      setCacheProbe({ key, cached: true, busy: false })
                                      showNotice(`删除缓存失败：${e instanceof Error ? e.message : String(e)}`)
                                    }
                                  })()
                                }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-accent hover:bg-accent/10"
                              >
                                <Trash2 size={14} strokeWidth={1.75} />
                                删除缓存
                              </button>
                            ) : (
                              <button
                                type="button"
                                data-testid="song-cache-add"
                                onClick={() => {
                                  const key = `${song.id}-${index}`
                                  setMenuFor(null)
                                  setCacheProbe({ key, cached: false, busy: true })
                                  void (async () => {
                                    try {
                                      await cacheSong(song)
                                      setCacheProbe({ key, cached: true, busy: false })
                                      showNotice(`已缓存《${song.title}》`)
                                    } catch (e) {
                                      setCacheProbe({ key, cached: false, busy: false })
                                      showNotice(`缓存失败：${e instanceof Error ? e.message : String(e)}`)
                                    }
                                  })()
                                }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-primary hover:bg-hover"
                              >
                                <Download size={14} strokeWidth={1.75} />
                                缓存到本地
                              </button>
                            )}
                          </>
                        )}
                        {onRemove != null && (
                          <button
                            type="button"
                            onClick={() => {
                              setMenuFor(null)
                              onRemove(song)
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-accent hover:bg-accent/10"
                          >
                            <Trash2 size={14} strokeWidth={1.75} />
                            {removeLabel}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
