/**
 * 搜索视图 —— 空关键词显示分类浏览 + 最近搜索；有关键词显示结果 Tabs。
 * 注：我们的后端返回 resultType = song | playlist，故结果 Tab 为「单曲 / 歌单」。
 * 「音源范围」选择器内嵌在搜索框右侧（SearchScopeSelector 紧凑下拉），对应 MusicSearchScope。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search, X, Play, Heart, Loader2, KeyRound } from 'lucide-react'
import { Cover } from '../components/Cover'
import { usePlayer } from '../contexts/PlayerContext'
import { useAuth, useLibrary } from '../state/hooks'
import { toggleLikeGuarded } from '../state/likeAction'
import { getServices } from '../services/runtime'
import type { MusicSearchScope as Scope } from '../services/models'
import { planScopeChange, SearchScopeSelector } from '../components/SearchScopeSelector'
import { DeskRoute, useRoute } from '../state/route'
import { toSongs, durationSeconds, formatTime, songCover } from '../state/songUtils'
import { GENRES } from '../state/genres'
import {
  CHKSZ_KEY_MISSING,
  runSearch,
  resetSearch,
  setSearchTab,
  useSearchState,
  type SearchRunner,
} from '../state/searchState'
import {
  clearRecentSearches,
  loadRecentSearches,
  pushRecentSearch,
  removeRecentSearch,
} from '../state/recentSearches'
import type { Song } from '../services/models'

export function SearchView() {
  const route = useRoute()
  const player = usePlayer()
  const library = useLibrary()
  const auth = useAuth()

  // 搜索结果状态走模块级 store：路由切换（前进/后退、进出专注模式）会卸载重建
  // SearchView，状态放组件内会丢 —— 对齐 Dart 的模块级 Riverpod provider。
  // 输入框文字不跨卸载持久化，单独用组件内 state。
  const search = useSearchState()
  const [input, setInput] = useState(route.searchSeed !== '' ? route.searchSeed : search.query)
  const [recent, setRecent] = useState<string[]>(() => loadRecentSearches())
  const inputRef = useRef<HTMLInputElement>(null)

  const runner = useCallback<SearchRunner>(
    async (q, p, sc) => toSongs(await getServices().music.searchSongs(q, p, sc)),
    [],
  )

  // 路由带来的预填关键词
  useEffect(() => {
    if (route.searchSeed === '') return
    setInput(route.searchSeed)
    // 已有同一关键词的结果 → 直接恢复（后退/专注模式回来不重复请求）
    if (route.searchSeed.trim() === search.query.trim()) return
    void runSearch(runner, route.searchSeed, search.scope, 1, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.searchSeed])

  const submit = (q: string) => {
    setInput(q)
    setRecent(pushRecentSearch(q))
    // 把实际提交的关键词回填到当前历史条目的 seed（不产生新历史条目）：
    // 否则后退/进出专注模式重挂载时，路由里的旧 seed 与 store 的 query 发散，
    // 会拿旧关键词重搜一次，把本该保留的结果冲掉。
    route.replaceSearchSeed(q.trim())
    void runSearch(runner, q, search.scope, 1, false)
  }

  // 音源范围切换：语义与旧 chip 行一致（输入框有未提交文本就用它，否则用已提交关键词），
  // 但用未提交文本发起搜索时必须同步路由 seed（不写最近搜索）—— 否则后退/进出专注模式
  // 重挂载时会拿旧 seed 重搜，把新结果冲掉（seed↔store 不变量见 route.replaceSearchSeed）。
  const handleScopeSelect = (next: Scope) => {
    const plan = planScopeChange(search.scope, next, input, search.query)
    if (plan == null) return // 重选当前范围：不重复请求
    if (plan.usesUnsubmittedInput) route.replaceSearchSeed(plan.query)
    void runSearch(runner, plan.query, next, 1, false)
  }

  const songs = useMemo(
    () => search.results.filter((s) => s.resultType !== 'playlist'),
    [search.results],
  )
  const playlists = useMemo(
    () => search.results.filter((s) => s.resultType === 'playlist'),
    [search.results],
  )
  const visible = search.tab === 'song' ? songs : playlists

  const playFrom = (song: Song, index: number) => {
    const raw = songs.map((s) => s.extra)
    player.playSong(raw[index] ?? song.extra, raw)
  }

  const openPlaylist = (playlist: Song): void => {
    route.go(DeskRoute.PlaylistDetail, { playlistId: playlist.id })
  }

  // 结果区的分支用 if/else 先算好，避免 JSX 里的 6 级嵌套三元
  let resultsBody: ReactNode
  if (search.error === CHKSZ_KEY_MISSING) {
    resultsBody = (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/20 bg-accent/[0.05] px-4 py-3 text-[13px] text-primary">
        <KeyRound size={16} strokeWidth={1.75} className="text-accent" />
        ChKSz 音源未配置 API Key —— 在设置里填好后立即生效，无需重启。
        <button
          type="button"
          onClick={() => route.go(DeskRoute.Settings)}
          className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
        >
          去设置填写密钥
        </button>
      </div>
    )
  } else if (search.error != null) {
    resultsBody = (
      <div className="rounded-xl border border-subtle px-4 py-3 text-[13px] text-secondary">
        搜索失败：{search.error}
      </div>
    )
  } else if (search.loading) {
    resultsBody = (
      <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-secondary">
        <Loader2 size={16} className="animate-spin" /> 搜索中…
      </div>
    )
  } else if (visible.length === 0) {
    resultsBody = (
      <div className="py-16 text-center text-[13px] text-secondary">
        没有找到匹配的{search.tab === 'song' ? '歌曲' : '歌单'}
      </div>
    )
  } else if (search.tab === 'song') {
    resultsBody = (
      <div className="space-y-0.5">
        {songs.map((song, i) => {
          const liked = library.isLiked(song)
          const isCurrent = player.currentSong?.['id']?.toString() === song.id
          return (
            <div
              key={`${song.id}-${i}`}
              onDoubleClick={() => playFrom(song, i)}
              className={`group flex items-center gap-4 rounded-xl px-3 py-2 transition-colors hover:bg-hover ${isCurrent ? 'bg-accent/[0.06]' : ''}`}
            >
              <span className="w-5 text-center text-[12px] tabular-nums text-secondary">
                {i + 1}
              </span>
              <Cover src={songCover(song)} size={40} radius="rounded-lg" iconSize={15} seed={song.title} />
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-[13.5px] font-medium ${isCurrent ? 'text-accent' : 'text-primary'}`}
                >
                  {song.title}
                </div>
                <div className="truncate text-[12px] text-secondary">{song.artist}</div>
              </div>
              <span className="text-[12px] text-secondary">
                {song.extra['source']?.toString() ?? ''}
              </span>
              <span className="w-10 text-right text-[12px] tabular-nums text-secondary">
                {formatTime(durationSeconds(song))}
              </span>
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
              <button
                type="button"
                aria-label="播放"
                onClick={() => playFrom(song, i)}
                className="text-primary opacity-0 transition-opacity group-hover:opacity-100"
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
            <div className="mt-2 truncate text-[13.5px] font-medium text-primary">
              {pl.title}
            </div>
            <div className="truncate text-[12px] text-secondary">
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
      <h1 className="text-3xl font-bold tracking-tight text-primary">搜索</h1>

      {/* 搜索框：音源范围选择器内嵌右侧。flex 布局让图标/输入框/清空按钮/选择器
          天然不重叠，窄屏下输入框收缩、触发器 shrink-0 保持当前范围始终可见。
          外框自己处理「点空白处聚焦输入框」：图标 pointer-events-none，点它或外框 padding
          时 target === currentTarget 且就是外框 → 聚焦输入框（旧布局是整条 input，点哪儿
          都能直接打字）；点到清空按钮 / 音源触发器 / 菜单 / 遮罩时 target 是子元素，
          这里一律不插手，否则会抢焦点或吃掉子控件自己的 click。 */}
      <div
        className="flex items-center gap-2 rounded-xl border border-subtle bg-card py-3 pl-4 pr-3 transition-colors focus-within:border-accent/40"
        onMouseDown={(e) => {
          // 只认「左键 + 落在外框自身」：图标 pointer-events-none，点图标/padding 时 target
          // 就是外框 → 聚焦输入框（旧布局整条都是 input，点哪儿都能直接打字）；点到清空按钮/
          // 音源触发器/菜单/遮罩时 target 是子元素，一律不插手 —— 否则会抢它们的焦点或吃掉 click。
          // preventDefault 是为了不让默认的「点非可聚焦元素 → 焦点丢到 body」清掉输入框光标/选区。
          if (e.button !== 0 || e.target !== e.currentTarget) return
          e.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <Search size={16} strokeWidth={1.75} className="pointer-events-none shrink-0 text-secondary" />
        <input
          ref={inputRef}
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit(input)
          }}
          placeholder="搜索歌曲、歌手、歌单…（回车确认）"
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-secondary"
        />
        {input !== '' && (
          <button
            type="button"
            aria-label="清空"
            onClick={() => {
              // resetSearch 会让在途请求的响应失效，否则清空后旧结果仍会回填
              resetSearch()
              // seed 同样回填为空，与 store 对齐（后退重挂载不会拿旧关键词重搜）
              route.replaceSearchSeed('')
              setInput('')
            }}
            className="shrink-0 text-secondary transition-colors hover:text-primary"
          >
            <X size={15} strokeWidth={1.75} />
          </button>
        )}
        <SearchScopeSelector scope={search.scope} onSelect={handleScopeSelect} />
      </div>

      {/* 空状态：最近搜索 + 分类（判定源与结果区一致，都用已提交的关键词 —— 对齐 Dart 的 searchQueryProvider） */}
      {search.query.trim() === '' && (
        <div className="space-y-8">
          {recent.length > 0 && (
            <div>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="text-[15px] font-semibold text-primary">最近搜索</h2>
                <button
                  type="button"
                  data-testid="recent-search-clear"
                  onClick={() => setRecent(clearRecentSearches())}
                  className="ml-auto text-[12px] text-secondary transition-colors hover:text-primary"
                >
                  清空
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((q) => (
                  <span
                    key={q}
                    className="group flex items-center rounded-full bg-fill transition-colors hover:bg-hover"
                  >
                    <button
                      type="button"
                      onClick={() => submit(q)}
                      className="py-1.5 pl-3.5 pr-1 text-[12.5px] text-primary"
                    >
                      {q}
                    </button>
                    <button
                      type="button"
                      data-testid="recent-search-remove"
                      aria-label={`删除最近搜索 ${q}`}
                      onClick={() => setRecent(removeRecentSearch(q))}
                      className="pr-2.5 pl-0.5 text-secondary opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary"
                    >
                      <X size={12} strokeWidth={2.2} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <h2 className="mb-4 text-[15px] font-semibold text-primary">热门分类浏览</h2>
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
        </div>
      )}

      {/* 结果 */}
      {search.query.trim() !== '' && (
        <div>
          <div className="mb-4 flex items-center gap-6 border-b border-subtle">
            {(
              [
                ['song', `单曲 ${songs.length}`],
                ['playlist', `歌单 ${playlists.length}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSearchTab(key)}
                className={`-mb-px border-b-2 pb-2 text-[13.5px] transition-colors ${
                  search.tab === key
                    ? 'border-accent font-medium text-accent'
                    : 'border-transparent text-secondary hover:text-primary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {resultsBody}

          {!search.loading && visible.length > 0 && (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                disabled={search.loadingMore}
                onClick={() =>
                  void runSearch(runner, search.query, search.scope, search.page + 1, true)
                }
                className="rounded-full bg-fill px-5 py-2 text-[13px] text-primary transition-colors hover:bg-hover disabled:opacity-50"
              >
                {search.loadingMore ? '加载中…' : '加载更多'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
