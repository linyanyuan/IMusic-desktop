/**
 * 首页 —— 继续播放 / 精选推荐 / 热门歌单 / 推荐歌曲 / 最近播放。
 *
 * 与 Flutter `desktop_home_screen.dart` 对齐的三块主体：
 *   继续播放（_ContinuePlayingCard）+ 热门歌单（_HotPlaylistsGrid）+ 推荐歌曲（_RecommendedSongsTable）。
 * 另外补上真实「最近播放」（此前这块错误地展示推荐结果，等于没有历史）。
 *
 * 热门歌单是远端合集：点进去由 PlaylistDetailView 按 id 取（可看可播）。
 * 「继续播放」卡里的歌词行单独订阅播放进度（usePlayerTime），避免整页每 250ms 重渲染。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Play,
  Pause,
  Heart,
  Loader2,
  ListMusic,
  ChevronRight,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { Cover } from '../components/Cover'
import { Modal } from '../components/Modal'
import { TasteGenreChips } from '../components/TasteGenreChips'
import { usePlayer, usePlayerTime } from '../contexts/PlayerContext'
import { useAuth, useLibrary, useTastePreferences } from '../state/hooks'
import { DeskRoute, useRoute } from '../state/route'
import { genreLabel } from '../state/genres'
import { shouldOfferTasteOnboarding } from '../services/tastePreferences'
import { getServices } from '../services/runtime'
import { toSongs, formatTime, durationSeconds, songCover } from '../state/songUtils'
import { activeLyricIndex, parseLyrics, plainLyricLines } from '../state/lyrics'
import { dailyFeatured } from '../state/featured'
import { UserAvatar } from '../components/UserAvatar'
import type { Song } from '../services/models'

const HOT_PAGE_SIZE = 10

function SectionTitle({
  children,
  action,
  aside,
}: {
  children: React.ReactNode
  action?: React.ReactNode
  /** 标题右侧的补充说明（如「根据 流行 · 摇滚 推荐」），不是交互区 */
  aside?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h2 className="shrink-0 text-[19px] font-bold tracking-tight text-primary">{children}</h2>
        {aside}
      </div>
      {action}
    </div>
  )
}

/** 当前歌词行 —— 单独订阅进度，重渲染只发生在这一个节点 */
function LyricPeek({ lyrics }: { lyrics: string }) {
  const time = usePlayerTime()
  const lines = useMemo(() => parseLyrics(lyrics), [lyrics])
  const text = useMemo(() => {
    if (lines.length === 0) return plainLyricLines(lyrics)[0] ?? ''
    const active = activeLyricIndex(lines, time.currentTime)
    return active >= 0 ? lines[active].text : (lines[0]?.text ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, lyrics, time.currentTime])

  if (text === '') return null
  return (
    <div data-home-lyric className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-secondary">
      {text}
    </div>
  )
}

/** 继续播放卡（对应 Dart _ContinuePlayingCard，额外带当前歌词行） */
function ContinuePlayingCard({ song }: { song: Song }) {
  const player = usePlayer()
  const route = useRoute()

  return (
    <div className="flex items-center gap-5 rounded-2xl border border-subtle bg-card/70 p-4 backdrop-blur-xl">
      <Cover src={songCover(song)} size={84} radius="rounded-xl" iconSize={26} seed={song.title} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">
          继续播放
        </div>
        <div className="truncate text-[17px] font-semibold text-primary">{song.title}</div>
        <div className="truncate text-[13px] text-secondary">{song.artist}</div>
        <LyricPeek lyrics={player.lyrics} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          aria-label={player.isPlaying ? '暂停' : '继续播放'}
          onClick={() => player.togglePlay()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white shadow-[0_6px_18px_rgba(250,35,59,0.28)] transition-transform hover:scale-105"
        >
          {player.isPlaying ? (
            <Pause size={17} strokeWidth={2} fill="currentColor" />
          ) : (
            <Play size={17} strokeWidth={2} fill="currentColor" className="ml-[2px]" />
          )}
        </button>
        <button
          type="button"
          aria-label="打开歌词"
          onClick={() => route.go(DeskRoute.Focus)}
          className="flex items-center gap-1.5 rounded-full bg-fill px-4 py-2.5 text-[12.5px] font-medium text-primary transition-colors hover:bg-hover"
        >
          歌词
          <ChevronRight size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

/** 今日精选歌单大卡 —— 点击进合集详情；hover 播放键直接取曲目整单播放（取不到则进详情） */
function FeaturedPlaylistCard({ playlist }: { playlist: Song }) {
  const route = useRoute()
  const player = usePlayer()
  const cover = songCover(playlist)
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

  return (
    <div className="group relative h-[220px] overflow-hidden rounded-2xl text-left shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
      <button
        type="button"
        data-featured-card
        aria-label={`查看精选歌单 ${playlist.title}`}
        onClick={open}
        className="absolute inset-0"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-accent/25 via-fill to-secondary/25" />
        {cover != null && (
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute left-5 top-5 rounded-md bg-white/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-md">
          今日精选
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-5">
          <div className="line-clamp-2 text-[20px] font-bold leading-snug text-white drop-shadow">
            {playlist.title}
          </div>
          <div className="mt-0.5 truncate text-[13px] text-white/80">
            {playlist.extra['subtitle']?.toString() ?? playlist.artist}
          </div>
        </div>
      </button>
      <button
        type="button"
        aria-label={`播放精选歌单 ${playlist.title}`}
        disabled={resolving}
        onClick={() => void playAll()}
        className="absolute bottom-5 right-5 flex h-11 w-11 translate-y-1 items-center justify-center rounded-full bg-white/25 text-white opacity-0 backdrop-blur-xl transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 disabled:opacity-100"
      >
        {resolving ? (
          <Loader2 size={17} strokeWidth={2} className="animate-spin" />
        ) : (
          <Play size={17} strokeWidth={2} fill="currentColor" className="ml-[1px]" />
        )}
      </button>
    </div>
  )
}

function SongCard({ song, onPlay }: { song: Song; onPlay: () => void }) {
  const player = usePlayer()
  const isCurrent = player.currentSong?.['id']?.toString() === song.id
  return (
    <button type="button" data-song-card={song.id} onClick={onPlay} className="group text-left">
      <div className="relative">
        <Cover
          src={songCover(song)}
          size={0}
          radius="rounded-xl"
          className="!h-auto aspect-square w-full shadow-[0_4px_16px_rgba(0,0,0,0.05)] transition-shadow group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
          iconSize={28}
        />
        <div className="absolute bottom-2 right-2 flex h-9 w-9 translate-y-1 items-center justify-center rounded-full bg-card/80 text-accent opacity-0 shadow-md backdrop-blur-md transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <Play size={15} strokeWidth={2} fill="currentColor" className="ml-[1px]" />
        </div>
        {isCurrent && (
          <div className="absolute left-2 top-2 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">
            播放中
          </div>
        )}
      </div>
      <div className="mt-2 truncate text-[13.5px] font-medium text-primary">{song.title}</div>
      <div className="truncate text-[12px] text-secondary">{song.artist}</div>
    </button>
  )
}

/** 远端合集卡（热门歌单）：封面 + 标题 + 曲目数，点进歌单详情 */
function PlaylistCard({ playlist, onOpen }: { playlist: Song; onOpen: () => void }) {
  const cover = songCover(playlist)
  const count = Number(playlist.extra['songCount'] ?? playlist.extra['song_count'] ?? 0)
  return (
    <button type="button" data-playlist-card={playlist.id} onClick={onOpen} className="group text-left">
      <div className="relative">
        <Cover
          src={cover}
          size={0}
          radius="rounded-xl"
          className="!h-auto aspect-square w-full shadow-[0_4px_16px_rgba(0,0,0,0.05)] transition-shadow group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
          iconSize={28}
        />
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/25 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="rounded-full bg-card/85 px-3 py-1 text-[11.5px] font-medium text-primary backdrop-blur-md">
            查看合集
          </span>
        </div>
      </div>
      <div className="mt-2 line-clamp-2 text-[13.5px] font-medium leading-snug text-primary">
        {playlist.title}
      </div>
      <div className="truncate text-[12px] text-secondary">
        {playlist.artist}
        {count > 0 ? ` · ${count} 首` : ''}
      </div>
    </button>
  )
}

/** 首次口味引导卡（内嵌在「推荐歌曲」上方）：分类 chips 多选 1–5 个，或跳过 */
function TasteOnboardingCard({
  onStart,
  onSkip,
}: {
  onStart: (genres: string[]) => void
  onSkip: () => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  return (
    <div
      data-testid="taste-onboarding"
      className="mb-4 rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/[0.06] via-transparent to-sidebar/60 p-5"
    >
      <div className="flex items-start gap-3">
        <Sparkles size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-primary">
            选择你喜欢的音乐类型，为你定制推荐
          </div>
          <div className="mt-1 text-[12px] text-secondary">
            最多选 5 个；之后可在「调整口味」里随时修改。
          </div>
          <div className="mt-3">
            <TasteGenreChips selected={selected} onChange={setSelected} />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              data-testid="taste-start"
              disabled={selected.length === 0}
              onClick={() => onStart(selected)}
              className="rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              开始推荐
            </button>
            <button
              type="button"
              data-testid="taste-skip"
              onClick={onSkip}
              className="rounded-full px-4 py-2 text-[13px] text-secondary transition-colors hover:bg-hover"
            >
              跳过
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 「调整口味」弹窗 —— 与引导卡同一组 chips，额外提供清除偏好 */
function TastePreferencesModal({
  initial,
  onClose,
  onSave,
  onClear,
}: {
  initial: string[]
  onClose: () => void
  onSave: (genres: string[]) => void
  onClear: () => void
}) {
  // 条件渲染（open 时才挂载）—— 初始值直接取 useState 初值，不需要同步 effect
  const [selected, setSelected] = useState<string[]>(initial)
  return (
    <Modal open title="调整音乐口味" onClose={onClose} width={520}>
      <p className="text-[12.5px] text-secondary">
        选中的分类会作为首页「推荐歌曲」的依据（最多 5 个）。
      </p>
      <div className="mt-4">
        <TasteGenreChips selected={selected} onChange={setSelected} />
      </div>
      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          data-testid="taste-clear"
          onClick={onClear}
          className="rounded-full px-4 py-2 text-[13px] text-secondary transition-colors hover:bg-hover hover:text-accent"
        >
          清除偏好
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-[13px] text-secondary transition-colors hover:bg-hover"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="taste-save"
            disabled={selected.length === 0}
            onClick={() => onSave(selected)}
            className="rounded-full bg-accent px-5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function HomeView() {
  const player = usePlayer()
  const library = useLibrary()
  const auth = useAuth()
  const route = useRoute()

  const [recommended, setRecommended] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [recBatch, setRecBatch] = useState(1)
  const [recRefreshing, setRecRefreshing] = useState(false)
  const [hotPlaylists, setHotPlaylists] = useState<Song[]>([])
  const [hotLoading, setHotLoading] = useState(true)
  const [hotBatch, setHotBatch] = useState(0)
  const [hotRefreshing, setHotRefreshing] = useState(false)
  // 今日精选：以日期为种子的主题精选歌单（当天固定，次日换主题）
  const [featured, setFeatured] = useState<Song[]>([])
  const [featuredTheme, setFeaturedTheme] = useState('')
  // 推荐歌曲请求序号：过期响应（旧口味/旧 page 后到、连点换一批）直接丢弃
  const recReqRef = useRef(0)

  // 音乐口味偏好（localStorage，实时读取）：有偏好 → 个性化推荐，否则沿用默认 feed
  const taste = useTastePreferences()
  const prefs = taste.get()
  const selectedGenres = prefs.genres
  const tasteKey = selectedGenres.join(',')
  const showOnboarding = shouldOfferTasteOnboarding(prefs)
  const tasteSubtitle =
    selectedGenres.length > 0
      ? `根据 ${selectedGenres.map(genreLabel).join(' · ')} 推荐`
      : '热门推荐'
  const [tasteModalOpen, setTasteModalOpen] = useState(false)

  /**
   * 推荐歌曲加载：有口味偏好时调 getPersonalizedSongs（provider 内部失败会回退
   * 默认 feed），否则走原有 getRecommendedSongs。换一批 = page+1。
   */
  const loadRecommended = useCallback(
    async (page: number, mode: 'initial' | 'refresh' = 'initial') => {
      const requestId = ++recReqRef.current
      if (mode === 'initial') setLoading(true)
      else setRecRefreshing(true)
      try {
        const keys = taste.get().genres
        const songs =
          keys.length > 0
            ? await getServices().music.getPersonalizedSongs(keys, page)
            : await getServices().music.getRecommendedSongs(page)
        if (requestId !== recReqRef.current) return
        setRecommended(toSongs(songs))
        setRecBatch(page)
      } catch (e) {
        console.warn('[Home] 推荐加载失败', e)
        if (requestId !== recReqRef.current) return
        setRecommended([])
      } finally {
        // 只有最新请求能复位 loading，且两个开关一起复位 —— 避免旧请求被判过期后状态卡死
        if (requestId === recReqRef.current) {
          setLoading(false)
          setRecRefreshing(false)
        }
      }
    },
    [taste],
  )

  // 卸载后让在途推荐请求失效
  useEffect(() => () => {
    recReqRef.current += 1
  }, [])

  // 首次进入与口味变化都重载第 1 页（保存口味后 store 通知 → 本组件重渲染 → effect 触发）
  useEffect(() => {
    void loadRecommended(1, 'initial')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasteKey])

  useEffect(() => {
    let alive = true
    // 今日精选：日期种子 → 主题批次 → 前 2 个合集
    void (async () => {
      try {
        const daily = dailyFeatured(Date.now())
        const lists = await getServices().music.getHotPlaylists({
          limit: HOT_PAGE_SIZE,
          offset: daily.batch * HOT_PAGE_SIZE,
        })
        if (!alive) return
        setFeatured(toSongs(lists).slice(0, 2))
        setFeaturedTheme(daily.theme)
      } catch (e) {
        console.warn('[Home] 今日精选加载失败', e)
        if (alive) setFeatured([])
      }
    })()
    // 热门歌单（首批）
    void (async () => {
      try {
        const lists = await getServices().music.getHotPlaylists({ limit: HOT_PAGE_SIZE })
        if (alive) setHotPlaylists(toSongs(lists))
      } catch (e) {
        console.warn('[Home] 热门歌单加载失败', e)
        if (alive) setHotPlaylists([])
      } finally {
        if (alive) setHotLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // 热门歌单换一批：批次 +1 整体替换（服务端按批次轮换搜索主题，每批都是新主题）
  const refreshHot = async () => {
    setHotRefreshing(true)
    try {
      const next = hotBatch + 1
      const lists = await getServices().music.getHotPlaylists({
        limit: HOT_PAGE_SIZE,
        offset: next * HOT_PAGE_SIZE,
      })
      setHotBatch(next)
      setHotPlaylists(toSongs(lists))
    } catch (e) {
      console.warn('[Home] 热门歌单换一批失败', e)
    } finally {
      setHotRefreshing(false)
    }
  }

  // 换一批：拉推荐 feed 的下一页并整体替换（对照 BiliMusic 的换一批，不追加）
  const refreshRecommended = () => {
    void loadRecommended(recBatch + 1, 'refresh')
  }

  /** 保存口味：写库后由 store 通知重载；口味未变时（重存同一组）手动补一次刷新 */
  const applyTaste = (genres: string[]) => {
    const nextKey = genres.join(',')
    taste.set({ genres })
    setTasteModalOpen(false)
    if (nextKey === tasteKey) void loadRecommended(1, 'refresh')
  }

  const quickFavorites = useMemo(() => library.likedSongs.slice(0, 6), [library.likedSongs])
  const recentPlayed = useMemo(() => library.history.slice(0, 10), [library.history])
  const current = player.currentSong != null ? toSongs([player.currentSong])[0] : null

  const playList = (songs: Song[], index: number) => {
    const raw = songs.map((s) => s.extra)
    player.playSong(raw[index], raw)
  }

  const user = auth.user

  return (
    <div className="space-y-9">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-primary">首页</h1>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[13.5px] font-medium text-primary">
              {user?.nickname ?? user?.username ?? '未登录'}
            </div>
            <div className="text-[11.5px] text-secondary">
              {auth.isLoggedIn ? '已同步音乐库' : '登录后可同步收藏'}
            </div>
          </div>
          <UserAvatar user={user} size={36} />
        </div>
      </div>

      {/* 首次口味引导 —— 从未设置且未跳过时出现。
          紧跟在标题下方、继续播放之前：引导是「新用户第一件事」，不该埋在
          推荐歌曲区里（滚动到那里才能看到 = 基本会被忽略）。整页只保留这一处。 */}
      {showOnboarding && (
        <TasteOnboardingCard
          onStart={(genres) => applyTaste(genres)}
          onSkip={() => taste.skip()}
        />
      )}

      {/* 继续播放（含当前歌词行） */}
      {current != null && <ContinuePlayingCard song={current} />}

      {/* 今日精选 —— 以日期为种子的主题精选歌单（当天固定，次日换主题）。
          与「热门歌单」（手动换一批的浏览网格）和「推荐歌曲」（单曲 feed）职责分开：
          这里是编辑精选的大卡位，点击进入合集详情。 */}
      {featured.length > 0 && (
        <div data-home-section="featured">
          <SectionTitle
            action={
              <span className="text-[12px] text-secondary">主题 · {featuredTheme}</span>
            }
          >
            今日精选
          </SectionTitle>
          <div className="grid grid-cols-2 gap-6">
            {featured.map((pl) => (
              <FeaturedPlaylistCard key={pl.id} playlist={pl} />
            ))}
          </div>
        </div>
      )}

      {/* 热门歌单（远端合集，可点进详情；换一批整体替换，与推荐歌曲一致） */}
      <div data-home-section="hot-playlists">
        <SectionTitle
          action={
            <button
              type="button"
              aria-label="换一批热门歌单"
              onClick={() => void refreshHot()}
              disabled={hotRefreshing || hotLoading}
              className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              <RefreshCw size={13} strokeWidth={2} className={hotRefreshing ? 'animate-spin' : ''} />
              {hotRefreshing ? '加载中…' : '换一批'}
            </button>
          }
        >
          热门歌单
        </SectionTitle>
        {hotLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-secondary">
            <Loader2 size={16} className="animate-spin" /> 正在加载热门歌单
          </div>
        ) : hotPlaylists.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-secondary">
            <ListMusic size={16} strokeWidth={1.75} />
            暂无热门歌单
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-5">
            {hotPlaylists.map((pl) => (
              <PlaylistCard
                key={pl.id}
                playlist={pl}
                onOpen={() => route.go(DeskRoute.PlaylistDetail, { playlistId: pl.id })}
              />
            ))}
          </div>
        )}
      </div>

      {/* 推荐歌曲（单曲 feed，换一批整体替换 —— 对照 BiliMusic 推荐页） */}
      <div data-home-section="recommended">
        <SectionTitle
          aside={
            <>
              <span
                data-testid="taste-basis"
                className="truncate text-[12px] font-normal text-secondary"
              >
                {tasteSubtitle}
              </span>
              <button
                type="button"
                data-testid="taste-adjust"
                onClick={() => setTasteModalOpen(true)}
                className="shrink-0 text-[12px] font-medium text-accent transition-opacity hover:opacity-80"
              >
                调整口味
              </button>
            </>
          }
          action={
            <button
              type="button"
              aria-label="换一批推荐"
              onClick={() => refreshRecommended()}
              disabled={recRefreshing || loading}
              className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              <RefreshCw size={13} strokeWidth={2} className={recRefreshing ? 'animate-spin' : ''} />
              {recRefreshing ? '加载中…' : '换一批'}
            </button>
          }
        >
          推荐歌曲
        </SectionTitle>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-secondary">
            <Loader2 size={16} className="animate-spin" /> 加载中…
          </div>
        ) : recommended.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-secondary">
            暂无推荐内容，试试搜索一首歌
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-5">
            {recommended.slice(0, 10).map((song, i) => (
              <SongCard key={song.id} song={song} onPlay={() => playList(recommended.slice(0, 10), i)} />
            ))}
          </div>
        )}
      </div>

      {/* 最近播放（真实历史） */}
      {recentPlayed.length > 0 && (
        <div data-home-section="recent">
          <SectionTitle
            action={
              <button
                type="button"
                onClick={() => route.go(DeskRoute.History)}
                className="text-[12.5px] font-medium text-accent transition-opacity hover:opacity-80"
              >
                查看全部
              </button>
            }
          >
            最近播放
          </SectionTitle>
          <div className="grid grid-cols-5 gap-5">
            {recentPlayed.map((song, i) => (
              <SongCard
                key={`${song.id}-${i}`}
                song={song}
                onPlay={() => playList(recentPlayed, i)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 快速畅听 */}
      <div data-home-section="favorites">
        <SectionTitle>我喜欢的音乐 · 快速畅听</SectionTitle>
        {quickFavorites.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-secondary">
            还没有喜欢的歌曲 —— 点歌曲右侧的 ♥ 收藏
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            {quickFavorites.map((song) => (
              <div
                key={song.id}
                onDoubleClick={() => playList(quickFavorites, quickFavorites.indexOf(song))}
                className="group flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-hover"
              >
                <div className="relative">
                  <Cover src={songCover(song)} size={48} radius="rounded-lg" iconSize={16} seed={song.title} />
                  <button
                    type="button"
                    aria-label={`播放 ${song.title}`}
                    onClick={() => playList(quickFavorites, quickFavorites.indexOf(song))}
                    className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Play size={15} strokeWidth={2} fill="currentColor" className="ml-[1px]" />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium text-primary">
                    {song.title}
                  </div>
                  <div className="truncate text-[12px] text-secondary">{song.artist}</div>
                </div>
                <span className="text-[12px] tabular-nums text-secondary">
                  {formatTime(durationSeconds(song))}
                </span>
                <button
                  type="button"
                  aria-label="取消喜欢"
                  onClick={() => void library.toggleLike(song)}
                  className="text-accent transition-transform active:scale-90"
                >
                  <Heart size={15} strokeWidth={1.75} fill="currentColor" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 调整口味弹窗（条件渲染，避开 initial 同步问题） */}
      {tasteModalOpen && (
        <TastePreferencesModal
          initial={selectedGenres}
          onClose={() => setTasteModalOpen(false)}
          onSave={(genres) => applyTaste(genres)}
          onClear={() => {
            taste.clear()
            setTasteModalOpen(false)
          }}
        />
      )}
    </div>
  )
}
