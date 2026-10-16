/**
 * 搜索状态 store —— 模块级、跨组件卸载存活。
 *
 * 为什么需要：`SearchView` 把「关键词 / 结果 / Tab / 音源范围 / 页码 / 错误」放在组件内
 * `useState`，但路由切换会让它卸载重建（去歌单详情后按后退、进出专注模式 —— 见
 * `src/state/route.tsx`：专注模式是把路由换成 FocusView），于是用户丢掉搜索结果、
 * 回到空搜索页。
 *
 * 对齐的 Dart 文件：`lib/desktop/screens/desktop_search_screen.dart` 第 24-38 行的
 * 模块级 Riverpod provider（searchQueryProvider / searchResultsProvider /
 * searchLoadingProvider / searchLoadingMoreProvider / searchPageProvider /
 * searchHasMoreProvider / searchTabProvider / searchSourceProvider /
 * searchErrorProvider），`initState` 从这些 provider 恢复界面。
 *
 * 这里用与 notice.ts / shortcutStatus.ts 同一套「模块级 store + useSyncExternalStore」
 * 最小发布订阅实现等价语义。**只保留当前这一次搜索的一份状态**（不像列表那样按 key
 * 缓存），所以条目数有界：结果列表随下一次搜索整体替换，不会累积历史搜索。
 *
 * 刻意不依赖 window / DOM，纯逻辑 + useSyncExternalStore，便于 `node --test` 直接测。
 */

import { useSyncExternalStore } from 'react'
import { MusicSearchScope } from '../services/models'
import type { MusicSearchScope as Scope } from '../services/models'
import type { Song } from '../services/models'

export type SearchTabId = 'song' | 'playlist'

export interface SearchState {
  query: string
  scope: Scope
  tab: SearchTabId
  results: Song[]
  page: number
  error: string | null
  loading: boolean
  loadingMore: boolean
}

/** 发请求的函数（由视图注入，避免 store 直接依赖 services 单例） */
export type SearchRunner = (query: string, page: number, scope: Scope) => Promise<Song[]>

const INITIAL_STATE: SearchState = {
  query: '',
  scope: MusicSearchScope.All,
  tab: 'song',
  results: [],
  page: 1,
  error: null,
  loading: false,
  loadingMore: false,
}

let state: SearchState = INITIAL_STATE

/**
 * 在途请求序号 —— 模块级，跨卸载存活。
 *
 * 与旧 `SearchView` 的 `requestIdRef`、Dart 的 `_searchRequestId` 同一用途：
 * 只有最后发起的那次请求可以把结果写回，过期响应一律丢弃。
 */
let requestId = 0

const listeners = new Set<() => void>()

/** 发布新状态：每次都用新对象引用（`{...state, ...}`），否则 useSyncExternalStore 不重渲染 */
function publish(next: SearchState): void {
  state = next
  for (const listener of listeners) listener()
}

/** 当前状态快照；引用稳定（未变化时多次调用返回同一对象） */
export function getSearchState(): SearchState {
  return state
}

export function subscribeSearch(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSearchState(): SearchState {
  return useSyncExternalStore(subscribeSearch, getSearchState, getSearchState)
}

/** 切换结果 Tab；值相同则不发布（避免无谓重渲染） */
export function setSearchTab(tab: SearchTabId): void {
  if (state.tab === tab) return
  publish({ ...state, tab })
}

/**
 * 清空搜索（输入框清空按钮）。
 *
 * 保留 tab 与 scope（用户选的 Tab/音源范围不因清空而重置，与 Dart provider 一致），
 * 清掉关键词/结果/错误/加载态，并让在途响应失效 —— 否则清空后旧结果仍会回填。
 */
export function resetSearch(): void {
  requestId += 1
  publish({
    ...state,
    query: '',
    results: [],
    page: 1,
    error: null,
    loading: false,
    loadingMore: false,
  })
}

/** ChKSz 未配置 key 时给出明确提示（视图据此渲染「去设置填写密钥」），而不是空列表 */
function mapSearchError(message: string): string {
  return message.includes('ChKSz') || message.toLowerCase().includes('api key')
    ? 'CHKSZ_KEY_MISSING'
    : message
}

/**
 * 执行一次搜索。
 *
 * - `append=true` 为「加载更多」：结果拼接、页码推进、别的字段不动；
 * - `append=false` 为新搜索：先清空结果并置 loading；
 * - 空关键词不发请求，只把状态清干净（scope 仍更新）；
 * - 过期响应（期间又发起了新搜索，或用户清了空）直接丢弃，不写状态。
 */
export async function runSearch(
  runner: SearchRunner,
  query: string,
  scope: Scope,
  page: number,
  append: boolean,
): Promise<void> {
  const trimmed = query.trim()
  const id = ++requestId

  // 先发布意图：scope 永远更新；append 走 loadingMore，新搜索清空结果并走 loading
  if (append) {
    publish({ ...state, scope, loadingMore: true, error: null })
  } else {
    publish({
      ...state,
      scope,
      query: trimmed,
      loading: true,
      results: [],
      page: 1,
      error: null,
    })
  }

  if (trimmed === '') {
    publish({
      ...state,
      query: '',
      results: [],
      page: 1,
      error: null,
      loading: false,
      loadingMore: false,
    })
    return
  }

  try {
    const songs = await runner(trimmed, page, scope)
    if (id !== requestId) return // 过期响应丢弃
    publish({
      ...state,
      results: append ? [...state.results, ...songs] : songs,
      page,
      error: null,
      loading: false,
      loadingMore: false,
    })
  } catch (e) {
    if (id !== requestId) return
    const message = e instanceof Error ? e.message : String(e)
    publish({
      ...state,
      error: mapSearchError(message),
      results: append ? state.results : [],
      loading: false,
      loadingMore: false,
    })
  }
}
