/**
 * 搜索视图 —— 空关键词显示分类浏览 + 最近搜索；有关键词显示结果 Tabs。
 * 注：我们的后端返回 resultType = song | playlist，故结果 Tab 为「单曲 / 歌单」，
 * 另加「音源范围」选择器（B站混合 / 元数据歌曲 / B站歌单 / ChKSz），对应 MusicSearchScope；
 * 选择器下方常显当前范围的说明，避免「B站歌单」被误读成「B站全部内容」。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Search, X, Play, Heart, Loader2, KeyRound } from 'lucide-react'
import { Cover } from '../components/Cover'
import { usePlayer } from '../contexts/PlayerContext'
import { useAuth, useLibrary } from '../state/hooks'
import { toggleLikeGuarded } from '../state/likeAction'
import { getServices } from '../services/runtime'
import { MusicSearchScope, type MusicSearchScope as Scope } from '../services/models'
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

/**
 * 音源范围 —— 对应 MusicSearchScope；label 是 chip 上的短标签，hint 是它的说明。
 * 用词对齐 Flutter 搜索栏的音源下拉（desktop_search_screen.dart 第 425-445 行）：
 * 「默认源 · B站混合 —— 歌曲、歌单、合集综合搜索」。用户反馈「B站歌单里怎么只能搜歌单」
 * 就是被旧标签误导：B站单曲其实在「B站混合」里，这里把两者说清楚。
 */
const SCOPE_TABS: Array<{ key: Scope; label: string; hint: string }> = [
  { key: MusicSearchScope.All, label: 'B站混合', hint: 'B站单曲 / 歌单 / 合集 + 元数据单曲（默认源，综合搜索）' },
  { key: MusicSearchScope.MetadataSongs, label: '元数据歌曲', hint: '仅元数据音源（GDStudio / Meting），不含 B站' },
  { key: MusicSearchScope.BilibiliPlaylists, label: 'B站歌单', hint: '仅 B站歌单，不含单曲；单曲请用「B站混合」' },
  { key: MusicSearchScope.ChkszSongs, label: 'ChKSz', hint: 'ChKSz 网易云，仅单曲；需先在设置里填 API Key' },
]

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

      {/* 搜索框 */}
      <div className="relative">
        <Search
          size={16}
          strokeWidth={1.75}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-secondary"
        />
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit(input)
          }}
          placeholder="搜索歌曲、歌手、歌单…（回车确认）"
          className="w-full rounded-xl border border-subtle bg-card py-3 pl-11 pr-10 text-[14px] outline-none transition-colors placeholder:text-secondary focus:border-accent/40"
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
            className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary hover:text-primary"
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
            data-testid={`search-scope-${s.key}`}
            title={s.hint}
            aria-label={`${s.label}：${s.hint}`}
            onClick={() => {
              // 输入框有未提交的文字就用它，否则用已提交的关键词重搜
              // （输入框被手动清空但结果还在时，切音源范围不该把结果清掉）
              void runSearch(
                runner,
                input.trim() !== '' ? input : search.query,
                s.key,
                1,
                false,
              )
            }}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors ${
              search.scope === s.key
                ? 'bg-accent/10 font-medium text-accent'
                : 'bg-fill text-primary hover:bg-hover'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* 当前音源范围的说明：常显，避免「B站歌单」被误读成 B站全部内容 */}
      <p className="text-[12px] text-secondary">
        {SCOPE_TABS.find((s) => s.key === search.scope)?.hint ?? ''}
      </p>

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
