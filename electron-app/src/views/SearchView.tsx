/**
 * 搜索视图 —— 空关键词显示分类浏览 + 最近搜索；有关键词显示结果 Tabs。
 * 注：我们的后端返回 resultType = song | playlist，故结果 Tab 为「单曲 / 歌单」，
 * 另加「音源范围」选择器（全部 / 元数据 / B站歌单 / ChKSz），对应 MusicSearchScope。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search, X, Play, Heart, Loader2, KeyRound } from 'lucide-react'
import { Cover } from '../components/Cover'
import { usePlayer } from '../contexts/PlayerContext'
import { useLibrary } from '../state/hooks'
import { getServices } from '../services/runtime'
import { MusicSearchScope, type MusicSearchScope as Scope } from '../services/models'
import { DeskRoute, useRoute } from '../state/route'
import { toSongs, durationSeconds, formatTime, songCover } from '../state/songUtils'
import { GENRES } from '../state/genres'
import type { Song } from '../services/models'

const RECENT_KEY = 'imusic:recentSearches'

const SCOPE_TABS: Array<{ key: Scope; label: string }> = [
  { key: MusicSearchScope.All, label: '全部音源' },
  { key: MusicSearchScope.MetadataSongs, label: '元数据歌曲' },
  { key: MusicSearchScope.BilibiliPlaylists, label: 'B站歌单' },
  { key: MusicSearchScope.ChkszSongs, label: 'ChKSz' },
]

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw != null ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function pushRecent(query: string): void {
  const list = [query, ...loadRecent().filter((q) => q !== query)].slice(0, 8)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

export function SearchView() {
  const route = useRoute()
  const player = usePlayer()
  const library = useLibrary()

  const [query, setQuery] = useState(route.searchSeed)
  const [scope, setScope] = useState<Scope>(MusicSearchScope.All)
  const [tab, setTab] = useState<'song' | 'playlist'>('song')
  const [results, setResults] = useState<Song[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState<string[]>(() => loadRecent())
  const requestIdRef = useRef(0)

  const runSearch = useCallback(
    async (q: string, sc: Scope, p: number, append: boolean) => {
      const trimmed = q.trim()
      if (trimmed === '') {
        setResults([])
        setError(null)
        return
      }
      const reqId = ++requestIdRef.current
      if (append) setLoadingMore(true)
      else {
        setLoading(true)
        setResults([])
      }
      setError(null)
      try {
        const songs = await getServices().music.searchSongs(trimmed, p, sc)
        if (reqId !== requestIdRef.current) return // 过期响应丢弃
        const mapped = toSongs(songs)
        setResults((prev) => (append ? [...prev, ...mapped] : mapped))
        setPage(p)
      } catch (e) {
        if (reqId !== requestIdRef.current) return
        const message = e instanceof Error ? e.message : String(e)
        // ChKSz 未配置 key 时给出明确提示，而不是空列表
        setError(
          message.includes('ChKSz') || message.toLowerCase().includes('api key')
            ? 'CHKSZ_KEY_MISSING'
            : message,
        )
        if (!append) setResults([])
      } finally {
        if (reqId === requestIdRef.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [],
  )

  // 路由带来的预填关键词
  useEffect(() => {
    if (route.searchSeed !== '') {
      setQuery(route.searchSeed)
      void runSearch(route.searchSeed, scope, 1, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.searchSeed])

  const submit = (q: string) => {
    setQuery(q)
    pushRecent(q)
    setRecent(loadRecent())
    void runSearch(q, scope, 1, false)
  }

  const songs = useMemo(() => results.filter((s) => s.resultType !== 'playlist'), [results])
  const playlists = useMemo(() => results.filter((s) => s.resultType === 'playlist'), [results])
  const visible = tab === 'song' ? songs : playlists

  const playFrom = (song: Song, index: number) => {
    const raw = songs.map((s) => s.extra)
    player.playSong(raw[index] ?? song.extra, raw)
  }

  const openPlaylist = (playlist: Song): void => {
    route.go(DeskRoute.PlaylistDetail, { playlistId: playlist.id })
  }

  // 结果区的分支用 if/else 先算好，避免 JSX 里的 6 级嵌套三元
  let resultsBody: ReactNode
  if (error === 'CHKSZ_KEY_MISSING') {
    resultsBody = (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#FA233B]/20 bg-[#FA233B]/[0.05] px-4 py-3 text-[13px] text-[#1D1D1F]">
        <KeyRound size={16} strokeWidth={1.75} className="text-[#FA233B]" />
        ChKSz 音源未配置 API Key —— 在设置里填好后立即生效，无需重启。
        <button
          type="button"
          onClick={() => route.go(DeskRoute.Settings)}
          className="ml-auto rounded-lg bg-[#FA233B] px-3 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
        >
          去设置填写密钥
        </button>
      </div>
    )
  } else if (error != null) {
    resultsBody = (
      <div className="rounded-xl border border-[#E5E5EA] px-4 py-3 text-[13px] text-[#86868B]">
        搜索失败：{error}
      </div>
    )
  } else if (loading) {
    resultsBody = (
      <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[#86868B]">
        <Loader2 size={16} className="animate-spin" /> 搜索中…
      </div>
    )
  } else if (visible.length === 0) {
    resultsBody = (
      <div className="py-16 text-center text-[13px] text-[#86868B]">
        没有找到匹配的{tab === 'song' ? '歌曲' : '歌单'}
      </div>
    )
  } else if (tab === 'song') {
    resultsBody = (
      <div className="space-y-0.5">
        {songs.map((song, i) => {
          const liked = library.isLiked(song)
          const isCurrent = player.currentSong?.['id']?.toString() === song.id
          return (
            <div
              key={`${song.id}-${i}`}
              onDoubleClick={() => playFrom(song, i)}
              className={`group flex items-center gap-4 rounded-xl px-3 py-2 transition-colors hover:bg-[#F5F5F7]/80 ${isCurrent ? 'bg-[#FA233B]/[0.06]' : ''}`}
            >
              <span className="w-5 text-center text-[12px] tabular-nums text-[#86868B]">
                {i + 1}
              </span>
              <Cover src={songCover(song)} size={40} radius="rounded-lg" iconSize={15} seed={song.title} />
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-[13.5px] font-medium ${isCurrent ? 'text-[#FA233B]' : 'text-[#1D1D1F]'}`}
                >
                  {song.title}
                </div>
                <div className="truncate text-[12px] text-[#86868B]">{song.artist}</div>
              </div>
              <span className="text-[12px] text-[#86868B]">
                {song.extra['source']?.toString() ?? ''}
              </span>
              <span className="w-10 text-right text-[12px] tabular-nums text-[#86868B]">
                {formatTime(durationSeconds(song))}
              </span>
              <button
                type="button"
                aria-label={liked ? '取消喜欢' : '喜欢'}
                onClick={() => void library.toggleLike(song).catch(() => {})}
                className={`transition-transform active:scale-90 ${
                  liked ? 'text-[#FA233B]' : 'text-[#C7C7CC] opacity-0 group-hover:opacity-100'
                }`}
              >
                <Heart size={15} strokeWidth={1.75} fill={liked ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                aria-label="播放"
                onClick={() => playFrom(song, i)}
                className="text-[#1D1D1F] opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Play size={15} strokeWidth={2} fill="currentColor" />
              </button>
            </div>
          )
        })}
      </div>
    )
  } else {
    resultsBody = (
      <div className="grid grid-cols-4 gap-5">
        {playlists.map((pl, i) => (
          <button
            key={`${pl.id}-${i}`}
            type="button"
            data-testid="search-playlist-card"
            onClick={() => openPlaylist(pl)}
            className="group text-left"
          >
            <Cover
              src={songCover(pl)}
              size={0}
              radius="rounded-xl"
              className="!h-auto aspect-square w-full shadow-[0_4px_16px_rgba(0,0,0,0.05)]"
            />
            <div className="mt-2 truncate text-[13.5px] font-medium text-[#1D1D1F]">
              {pl.title}
            </div>
            <div className="truncate text-[12px] text-[#86868B]">
              {pl.artist}
              {pl.songCount > 0 ? ` · ${pl.songCount} 首` : ''}
            </div>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-7">
      <h1 className="text-3xl font-bold tracking-tight text-[#1D1D1F]">搜索</h1>

      {/* 搜索框 */}
      <div className="relative">
        <Search
          size={16}
          strokeWidth={1.75}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#86868B]"
        />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit(query)
          }}
          placeholder="搜索歌曲、歌手、歌单…（回车确认）"
          className="w-full rounded-xl border border-[#E5E5EA] bg-white py-3 pl-11 pr-10 text-[14px] outline-none transition-colors placeholder:text-[#86868B] focus:border-[#FA233B]/40"
        />
        {query !== '' && (
          <button
            type="button"
            aria-label="清空"
            onClick={() => {
              // 让在途请求的响应失效，否则清空后旧结果仍会回填
              requestIdRef.current += 1
              setQuery('')
              setResults([])
              setError(null)
              setLoading(false)
              setLoadingMore(false)
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868B] hover:text-[#1D1D1F]"
          >
            <X size={15} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {/* 音源范围 */}
      <div className="flex flex-wrap gap-2">
        {SCOPE_TABS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              setScope(s.key)
              if (query.trim() !== '') void runSearch(query, s.key, 1, false)
            }}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors ${
              scope === s.key
                ? 'bg-[#FA233B]/10 font-medium text-[#FA233B]'
                : 'bg-[#F5F5F7] text-[#1D1D1F] hover:bg-black/[0.07]'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* 空状态：分类 + 最近搜索 */}
      {query.trim() === '' && results.length === 0 && (
        <div className="space-y-8">
          <div>
            <h2 className="mb-4 text-[15px] font-semibold text-[#1D1D1F]">热门分类浏览</h2>
            {/* 分类卡改走「分类详情」（真实分类歌单/单曲），不再当关键词去搜
                —— 旧行为会搜出「标题含分类名」的歌，语义是错的 */}
            <div className="grid grid-cols-3 gap-4">
              {GENRES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  data-testid={`category-card-${c.key}`}
                  onClick={() => route.go(DeskRoute.Category, { categoryKey: c.key })}
                  className="h-[92px] overflow-hidden rounded-2xl p-4 text-left text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-transform hover:scale-[1.02]"
                  style={{ background: `linear-gradient(135deg, ${c.from}, ${c.to})` }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          {recent.length > 0 && (
            <div>
              <h2 className="mb-3 text-[15px] font-semibold text-[#1D1D1F]">最近搜索</h2>
              <div className="flex flex-wrap gap-2">
                {recent.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => submit(q)}
                    className="rounded-full bg-[#F5F5F7] px-3.5 py-1.5 text-[12.5px] text-[#1D1D1F] transition-colors hover:bg-black/[0.07]"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 结果 */}
      {query.trim() !== '' && (
        <div>
          <div className="mb-4 flex items-center gap-6 border-b border-[#E5E5EA]">
            {(
              [
                ['song', `单曲 ${songs.length}`],
                ['playlist', `歌单 ${playlists.length}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 pb-2 text-[13.5px] transition-colors ${
                  tab === key
                    ? 'border-[#FA233B] font-medium text-[#FA233B]'
                    : 'border-transparent text-[#86868B] hover:text-[#1D1D1F]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {resultsBody}

          {!loading && visible.length > 0 && (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void runSearch(query, scope, page + 1, true)}
                className="rounded-full bg-[#F5F5F7] px-5 py-2 text-[13px] text-[#1D1D1F] transition-colors hover:bg-black/[0.07] disabled:opacity-50"
              >
                {loadingMore ? '加载中…' : '加载更多'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
