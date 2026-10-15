/**
 * 视图路由 —— 对应 Flutter DeskRoute（单 Shell + in-shell 路由，不走 Navigator）。
 * 带前进/后退历史（history.ts 纯函数核）；专注模式不进历史。
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  canGoBack as historyCanGoBack,
  canGoForward as historyCanGoForward,
  emptyHistory,
  goBack as historyGoBack,
  goForward as historyGoForward,
  navigateTo,
  replaceCurrent,
  type NavHistory,
} from './history'

export const DeskRoute = {
  Home: 'home',
  Search: 'search',
  Library: 'library',
  Favorites: 'favorites',
  History: 'history',
  PlaylistDetail: 'playlistDetail',
  Focus: 'focus',
  Profile: 'profile',
  Settings: 'settings',
} as const
export type DeskRoute = (typeof DeskRoute)[keyof typeof DeskRoute]

export interface RouteState {
  route: DeskRoute
  /** PlaylistDetail 时选中的歌单 id（'favorites' 表示我喜欢的音乐） */
  playlistId: string | null
  /** 搜索页预填关键词 */
  searchSeed: string
}

export interface RouteApi extends RouteState {
  go: (route: DeskRoute, opts?: { playlistId?: string; searchSeed?: string }) => void
  openSearch: (seed: string) => void
  /** 专注模式开关：进入时记住来源，退出时回到来源（对应 Flutter toggleDeskFocusRoute） */
  toggleFocus: () => void
  /** 后退一步（无历史时无操作） */
  back: () => void
  /** 前进一步（无前进历史时无操作） */
  forward: () => void
  canGoBack: boolean
  canGoForward: boolean
}

const RouteContext = createContext<RouteApi | null>(null)

function sameRouteState(a: RouteState, b: RouteState): boolean {
  return a.route === b.route && a.playlistId === b.playlistId && a.searchSeed === b.searchSeed
}

const HOME_STATE: RouteState = { route: DeskRoute.Home, playlistId: null, searchSeed: '' }

export function RouteProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<NavHistory<RouteState>>(() => emptyHistory(HOME_STATE))

  // 专注模式的来源（不进历史栈；对应 Flutter toggleDeskFocusRoute 的恢复语义）
  const focusReturn = useRef<RouteState | null>(null)

  const go = useCallback<RouteApi['go']>((route, opts) => {
    if (route === DeskRoute.Focus) {
      // 专注模式是覆盖式沉浸模式，不进历史链
      setHistory((h) => {
        focusReturn.current = h.current.route === DeskRoute.Focus ? focusReturn.current : h.current
        return replaceCurrent(h, { route: DeskRoute.Focus, playlistId: null, searchSeed: '' })
      })
      return
    }
    const next: RouteState = {
      route,
      playlistId: opts?.playlistId ?? null,
      searchSeed: opts?.searchSeed ?? '',
    }
    setHistory((h) => navigateTo(h, next, sameRouteState))
  }, [])

  const openSearch = useCallback<RouteApi['openSearch']>((seed) => {
    setHistory((h) =>
      navigateTo(h, { route: DeskRoute.Search, playlistId: null, searchSeed: seed }, sameRouteState),
    )
  }, [])

  const toggleFocus = useCallback(() => {
    setHistory((h) => {
      if (h.current.route === DeskRoute.Focus) {
        const back = focusReturn.current
        focusReturn.current = null
        if (back != null && back.route !== DeskRoute.Focus) return replaceCurrent(h, back)
        return replaceCurrent(h, HOME_STATE)
      }
      focusReturn.current = h.current
      return replaceCurrent(h, { route: DeskRoute.Focus, playlistId: null, searchSeed: '' })
    })
  }, [])

  const back = useCallback(() => {
    setHistory((h) => {
      // 在专注模式里按后退：先退出专注回到来源（来源本就在历史链中，不再多走一步）
      if (h.current.route === DeskRoute.Focus) {
        const target = focusReturn.current
        focusReturn.current = null
        return replaceCurrent(h, target ?? HOME_STATE)
      }
      return historyGoBack(h) ?? h
    })
  }, [])

  const forward = useCallback(() => {
    setHistory((h) => historyGoForward(h) ?? h)
  }, [])

  const state = history.current
  const value = useMemo<RouteApi>(
    () => ({
      ...state,
      go,
      openSearch,
      toggleFocus,
      back,
      forward,
      canGoBack: historyCanGoBack(history),
      canGoForward: historyCanGoForward(history),
    }),
    [state, history, go, openSearch, toggleFocus, back, forward],
  )
  return <RouteContext.Provider value={value}>{children}</RouteContext.Provider>
}

export function useRoute(): RouteApi {
  const ctx = useContext(RouteContext)
  if (ctx == null) throw new Error('useRoute must be used within RouteProvider')
  return ctx
}
