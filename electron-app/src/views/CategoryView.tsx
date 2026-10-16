/**
 * 分类详情 —— 搜索页「热门分类」卡片的落点（DeskRoute.Category）。
 *
 * 两个 Tab：
 *   - 热门歌单：网易云该分类下的热门歌单（4 列卡片网格，底部「加载更多」按 offset 翻页）
 *   - 热门单曲：该分类下热门歌单的曲目交错去重（约 30 首），「换一批」= page+1
 * 顶部渐变头图 + 分类名 + 「播放热门单曲」。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, RefreshCw, Loader2, ListMusic, Music2 } from 'lucide-react'
import { Cover } from '../components/Cover'
import { SongTable } from '../components/SongTable'
import { AddToPlaylistModal } from '../components/AddToPlaylistModal'
import { usePlayer } from '../contexts/PlayerContext'
import { DeskRoute, useRoute } from '../state/route'
import { genreByKey } from '../state/genres'
import { usePlayPlaylist } from '../state/playPlaylist'
import { getServices } from '../services/runtime'
import { toSongs, songCover } from '../state/songUtils'
import type { Song } from '../services/models'

/** 热门歌单每页数量（「加载更多」按该步长翻页） */
const PLAYLIST_PAGE_SIZE = 20

type TabId = 'playlists' | 'songs'

/**
 * 分类热门歌单卡 —— 悬浮效果对齐首页「今日精选」：封面缓慢放大 + 右下角播放键滑入。
 *
 * 结构要点：
 *   - 整卡可点（进歌单详情）由末尾那张铺满卡片的透明按钮承担（对照 FeaturedPlaylistCard 的
 *     `absolute inset-0` 详情按钮）；封面包一层 overflow-hidden 的 wrapper 负责圆角与阴影，
 *     缩放只作用在封面自己身上，阴影不跟着放大。
 *   - 播放键是独立 button，锚在封面右下角（不是嵌套在详情按钮里，嵌套 button 是非法 HTML）。
 *     它放在所有兄弟节点最后并抬到 z-10，因此浮在同样绝对定位的详情按钮之上、仍可点击。
 */
function CategoryPlaylistCard({ playlist }: { playlist: Song }) {
  const route = useRoute()
  const { resolving, playAll } = usePlayPlaylist(playlist)

  const open = () => route.go(DeskRoute.PlaylistDetail, { playlistId: playlist.id })

  return (
    <div className="group relative text-left">
      <div className="relative overflow-hidden rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.05)] transition-shadow duration-300 group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
        <Cover
          src={songCover(playlist)}
          size={0}
          radius="rounded-xl"
          className="!h-auto aspect-square w-full transition-transform duration-500 group-hover:scale-105"
        />
        <button
          type="button"
          aria-label={`播放歌单 ${playlist.title}`}
          disabled={resolving}
          onClick={() => void playAll()}
          className="pointer-events-none absolute bottom-2 right-2 z-10 flex h-9 w-9 translate-y-1 items-center justify-center rounded-full bg-card/85 text-accent opacity-0 shadow-md backdrop-blur-md transition-all duration-300 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 disabled:opacity-100"
        >
          {resolving ? (
            <Loader2 size={15} strokeWidth={2} className="animate-spin" />
          ) : (
            <Play size={15} strokeWidth={2} fill="currentColor" className="ml-[1px]" />
          )}
        </button>
      </div>
      <div className="mt-2 line-clamp-2 text-[13.5px] font-medium leading-snug text-primary">
        {playlist.title}
      </div>
      <div className="truncate text-[12px] text-secondary">
        {playlist.artist}
        {playlist.songCount > 0 ? ` · ${playlist.songCount} 首` : ''}
      </div>
      {/* 整卡点击进详情：透明按钮铺满卡片（含标题区），放在最后 → 盖在封面与文字之上。 */}
      <button
        type="button"
        data-testid="category-playlist-card"
        aria-label={`查看歌单 ${playlist.title}`}
        onClick={open}
        className="absolute inset-0 rounded-xl"
      />
    </div>
  )
}

export function CategoryView() {
  const route = useRoute()
  const player = usePlayer()
  const genre = genreByKey(route.categoryKey ?? '')
  const cat = genre?.neteaseCat ?? ''

  const [tab, setTab] = useState<TabId>('playlists')

  const [playlists, setPlaylists] = useState<Song[]>([])
  const [plLoading, setPlLoading] = useState(true)
  const [plLoadingMore, setPlLoadingMore] = useState(false)
  const [plError, setPlError] = useState<string | null>(null)
  const [plHasMore, setPlHasMore] = useState(false)
  const plOffsetRef = useRef(0)

  const [songs, setSongs] = useState<Song[]>([])
  const [songLoading, setSongLoading] = useState(true)
  const [songError, setSongError] = useState<string | null>(null)
  const [songPage, setSongPage] = useState(1)

  const [addTarget, setAddTarget] = useState<Song | null>(null)
  const [playingHot, setPlayingHot] = useState(false)
  // 过期响应丢弃（快速切分类/换一批时旧请求可能后到）。
  // 歌单与单曲各有独立计数器：两路加载互不干扰（共用同一个会让在途的那一路被判过期、loading 卡死）
  const playlistReqRef = useRef(0)
  const songReqRef = useRef(0)

  const loadPlaylists = useCallback(
    async (offset: number, append: boolean, requestId: number) => {
      if (cat === '') return
      if (append) setPlLoadingMore(true)
      else setPlLoading(true)
      setPlError(null)
      try {
        const rows = await getServices().music.getCategoryPlaylists(cat, {
          limit: PLAYLIST_PAGE_SIZE,
          offset,
        })
        if (requestId !== playlistReqRef.current) return
        const mapped = toSongs(rows)
        setPlaylists((prev) => (append ? [...prev, ...mapped] : mapped))
        plOffsetRef.current = offset + mapped.length
        setPlHasMore(mapped.length >= PLAYLIST_PAGE_SIZE)
      } catch (e) {
        if (requestId !== playlistReqRef.current) return
        setPlError(e instanceof Error ? e.message : String(e))
        if (!append) setPlaylists([])
        setPlHasMore(false)
      } finally {
        if (requestId === playlistReqRef.current) {
          setPlLoading(false)
          setPlLoadingMore(false)
        }
      }
    },
    [cat],
  )

  const loadSongs = useCallback(
    async (page: number, requestId: number): Promise<Song[]> => {
      if (cat === '') return []
      setSongLoading(true)
      setSongError(null)
      try {
        const rows = await getServices().music.getCategorySongs(cat, page)
        if (requestId !== songReqRef.current) return []
        const mapped = toSongs(rows)
        setSongs(mapped)
        setSongPage(page)
        return mapped
      } catch (e) {
        if (requestId !== songReqRef.current) return []
        setSongError(e instanceof Error ? e.message : String(e))
        setSongs([])
        return []
      } finally {
        if (requestId === songReqRef.current) setSongLoading(false)
      }
    },
    [cat],
  )

  // 切换分类（或进入本页）时整体重载：歌单第 1 页 + 单曲第 1 批
  useEffect(() => {
    const playlistRequestId = ++playlistReqRef.current
    const songRequestId = ++songReqRef.current
    plOffsetRef.current = 0
    setPlaylists([])
    setSongs([])
    setSongPage(1)
    setPlHasMore(false)
    if (cat === '') {
      setPlLoading(false)
      setSongLoading(false)
      setPlError('未知分类')
      setSongError('未知分类')
      return
    }
    void loadPlaylists(0, false, playlistRequestId)
    void loadSongs(1, songRequestId)
  }, [cat, loadPlaylists, loadSongs])

  const playQueue = (list: Song[], index: number) => {
    if (list.length === 0) return
    const queue = list.map((s) => s.extra)
    player.playSong(queue[index >= 0 ? index : 0], queue)
  }

  /** 顶部「播放热门单曲」：没加载过就先取第 1 批，再整批播放 */
  const playHotSongs = async () => {
    if (playingHot) return
    let list = songs
    if (list.length === 0) {
      setPlayingHot(true)
      try {
        list = await loadSongs(1, ++songReqRef.current)
      } finally {
        setPlayingHot(false)
      }
    }
    setTab('songs')
    if (list.length > 0) playQueue(list, 0)
  }

  if (genre == null) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Music2 size={40} strokeWidth={1.25} className="text-secondary" />
        <p className="mt-3 text-[14px] text-secondary">未知分类</p>
        <button
          type="button"
          onClick={() => route.go(DeskRoute.Search)}
          className="mt-4 rounded-full bg-fill px-5 py-2 text-[13px] text-primary transition-colors hover:bg-hover"
        >
          返回搜索
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6" data-testid="category-view" data-category={genre.key}>
      {/* 渐变头图 */}
      <div
        data-category-header
        className="relative overflow-hidden rounded-2xl px-8 py-9 text-white shadow-[0_12px_36px_rgba(0,0,0,0.14)]"
        style={{ background: `linear-gradient(135deg, ${genre.from}, ${genre.to})` }}
      >
        <div className="text-[11px] font-semibold uppercase tracking-wider text-white/75">
          Genre · {genre.neteaseCat}
        </div>
        <h1 className="mt-1 text-[38px] font-bold leading-tight tracking-tight">{genre.label}</h1>
        <p className="mt-1 text-[13px] text-white/80">网易云音乐 · {genre.neteaseCat}分类热门</p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            disabled={playingHot || songLoading}
            onClick={() => void playHotSongs()}
            className="flex items-center gap-2 rounded-full bg-card/95 px-5 py-2 text-[13.5px] font-medium text-primary transition-transform hover:scale-[1.02] disabled:opacity-60"
          >
            {playingHot ? (
              <Loader2 size={15} strokeWidth={2} className="animate-spin" />
            ) : (
              <Play size={15} strokeWidth={2} fill="currentColor" />
            )}
            播放热门单曲
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-subtle">
        {(
          [
            ['playlists', '热门歌单'],
            ['songs', '热门单曲'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            data-testid={`category-tab-${key}`}
            data-active={tab === key ? 'true' : 'false'}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[13.5px] transition-colors ${
              tab === key
                ? 'border-accent font-medium text-accent'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'playlists' && (
        <div className="space-y-5">
          {plError != null ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-[13px] text-secondary">歌单加载失败：{plError}</p>
              <button
                type="button"
                onClick={() => void loadPlaylists(0, false, ++playlistReqRef.current)}
                className="flex items-center gap-1.5 rounded-full bg-fill px-4 py-2 text-[12.5px] text-primary transition-colors hover:bg-hover"
              >
                <RefreshCw size={13} strokeWidth={2} />
                重试
              </button>
            </div>
          ) : plLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-secondary">
              <Loader2 size={16} className="animate-spin" /> 正在加载歌单…
            </div>
          ) : playlists.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-secondary">
              <ListMusic size={16} strokeWidth={1.75} />
              该分类暂无歌单
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-5">
                {playlists.map((pl) => (
                  <CategoryPlaylistCard key={pl.id} playlist={pl} />
                ))}
              </div>
              {plHasMore && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    disabled={plLoadingMore}
                    onClick={() => void loadPlaylists(plOffsetRef.current, true, ++playlistReqRef.current)}
                    className="rounded-full bg-fill px-5 py-2 text-[13px] text-primary transition-colors hover:bg-hover disabled:opacity-50"
                  >
                    {plLoadingMore ? '加载中…' : '加载更多'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'songs' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-[13px] text-secondary">
              {songLoading ? '正在加载…' : `${songs.length} 首歌曲`}
            </div>
            <button
              type="button"
              aria-label="换一批热门单曲"
              disabled={songLoading}
              onClick={() => void loadSongs(songPage + 1, ++songReqRef.current)}
              className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              <RefreshCw size={13} strokeWidth={2} className={songLoading ? 'animate-spin' : ''} />
              换一批
            </button>
          </div>

          {songError != null ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-[13px] text-secondary">单曲加载失败：{songError}</p>
              <button
                type="button"
                onClick={() => void loadSongs(songPage, ++songReqRef.current)}
                className="flex items-center gap-1.5 rounded-full bg-fill px-4 py-2 text-[12.5px] text-primary transition-colors hover:bg-hover"
              >
                <RefreshCw size={13} strokeWidth={2} />
                重试
              </button>
            </div>
          ) : songLoading && songs.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-secondary">
              <Loader2 size={16} className="animate-spin" /> 正在加载单曲…
            </div>
          ) : (
            <SongTable
              songs={songs}
              onPlay={(song) => playQueue(songs, songs.findIndex((s) => s.id === song.id))}
              onAddToPlaylist={(song) => setAddTarget(song)}
              emptyText="该分类暂无热门单曲"
            />
          )}
        </div>
      )}

      <AddToPlaylistModal
        song={addTarget}
        open={addTarget != null}
        onClose={() => setAddTarget(null)}
      />
    </div>
  )
}
