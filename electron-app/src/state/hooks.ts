/**
 * 服务 → React 粘合层。用订阅 + 版本号触发重渲染（避免 useSyncExternalStore
 * 对快照引用稳定性的严格要求）。
 */

import { useEffect, useReducer } from 'react'
import type { LibraryService } from '../services/library'
import type { AuthService } from '../services/auth'
import type { AppSettings } from '../services/appSettings'
import type { TastePreferencesStore } from '../services/tastePreferences'
import { tastePreferences } from '../services/tastePreferences'
import { getServices } from '../services/runtime'

function useSubscription<T>(target: T & { subscribe?: (fn: () => void) => () => void }): T {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (typeof target.subscribe !== 'function') return
    const unsubscribe = target.subscribe(() => bump())
    return () => {
      unsubscribe()
    }
  }, [target])
  return target
}

export function useLibrary(): LibraryService {
  return useSubscription(getServices().library)
}

export function useAuth(): AuthService {
  return useSubscription(getServices().auth)
}

export function useSettings(): AppSettings {
  return useSubscription(getServices().settings)
}

/** 音乐口味偏好（localStorage）：store 变更时自动重渲染，用 get() 取当前值 */
export function useTastePreferences(): TastePreferencesStore {
  return useSubscription(tastePreferences)
}
