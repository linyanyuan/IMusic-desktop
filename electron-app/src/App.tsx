/**
 * 应用壳 —— 无边框全屏三区布局（标题栏 / 侧边栏+主内容 / 播控栏）
 * 对应 Flutter DesktopAppShell 的单 Shell + in-shell 路由。
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { PlayerBar } from './components/PlayerBar'
import { PlayerProvider, usePlayer } from './contexts/PlayerContext'
import { DeskRoute, RouteProvider, useRoute } from './state/route'
import { HomeView } from './views/HomeView'
import { SettingsView } from './views/SettingsView'
import { SearchView } from './views/SearchView'
import { FavoritesView } from './views/FavoritesView'
import { HistoryView } from './views/HistoryView'
import { PlaylistDetailView } from './views/PlaylistDetailView'
import { LibraryView } from './views/LibraryView'
import { FocusView } from './views/FocusView'
import { ProfileView } from './views/ProfileView'
import { useAuth, useLibrary, useSettings } from './state/hooks'
import { toSong } from './state/songUtils'
import { useShortcuts } from './state/shortcuts'
import { UpdateDialog } from './components/UpdateDialog'
import { DesktopLyricsBridge } from './components/DesktopLyricsBridge'
import { MediaSessionBridge } from './components/MediaSessionBridge'
import { checkForUpdate, loadAppVersion } from './state/update'

function MainContent() {
  const route = useRoute()
  // 专注模式是自管滚动的全幅沉浸页，不吃外层内边距
  if (route.route === DeskRoute.Focus) {
    return (
      <main className="flex-1 overflow-hidden">
        <FocusView />
      </main>
    )
  }
  return (
    <main className="flex-1 overflow-y-auto px-8 pb-28 pt-6">
      {/* 前进/后退按钮在标题栏（对齐 Flutter 版位置），不在内容区 */}
      {/* 视图切换淡入淡出（M5 动效项）。只动 opacity：一旦带 transform，
          就会给内部 `position: fixed` 的元素（行内右键菜单遮罩等）造出
          包含块，反而让遮罩错位。 */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={route.route + (route.playlistId ?? '')}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          {route.route === DeskRoute.Home && <HomeView />}
          {route.route === DeskRoute.Search && <SearchView />}
          {route.route === DeskRoute.Library && <LibraryView />}
          {route.route === DeskRoute.Favorites && <FavoritesView />}
          {route.route === DeskRoute.History && <HistoryView />}
          {route.route === DeskRoute.PlaylistDetail && <PlaylistDetailView />}
          {route.route === DeskRoute.Profile && <ProfileView />}
          {route.route === DeskRoute.Settings && <SettingsView />}
        </motion.div>
      </AnimatePresence>
    </main>
  )
}

/** 每次切歌自动推入历史（去重由 library.addToHistory 负责） */
function PlaybackHistoryBridge() {
  const player = usePlayer()
  const library = useLibrary()
  const songId = player.currentSong?.['id']?.toString() ?? null

  useEffect(() => {
    if (player.currentSong == null) return
    void library.addToHistory(toSong(player.currentSong))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId])

  return null
}

/** 启动时恢复登录态并拉取音乐库 */
function Bootstrap() {
  const auth = useAuth()
  const library = useLibrary()
  const settings = useSettings()

  useEffect(() => {
    void (async () => {
      // 把设置里选定的缓存目录同步给主进程（缓存读写都在主进程）
      const snapshot = settings.getSnapshot()
      try {
        const dir = snapshot.cacheDirectory
        await window.imusicAPI?.cacheSetDirectory(dir.trim() === '' ? null : dir.trim())
        if (snapshot.cacheAutoCleanupEnabled) {
          await window.imusicAPI?.cacheClearExpired(
            Math.max(1, snapshot.cacheRetentionDays) * 24 * 60 * 60 * 1000,
          )
        }
      } catch (e) {
        console.warn('[Bootstrap] 缓存目录下发失败', e)
      }
      try {
        await auth.restoreStoredAuth()
      } catch {
        /* 离线启动容忍 */
      }
      // 只有已登录才拉云端音乐库：未登录时后端返回 401，没必要每次都制造一条告警
      // （本地播放历史在 LibraryService 构造时就已从 localStorage 读入，不依赖这里）
      if (auth.isLoggedIn) {
        try {
          await library.loadLibrary()
        } catch (e) {
          console.warn('[Bootstrap] 音乐库加载失败', e)
        }
      }
      // 更新检查放在最后：它是 24h 节流的静默检查，不能拖慢首屏
      // （对应 Dart 端启动时的自动检查）
      await loadAppVersion()
      await checkForUpdate(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

export default function App() {
  return (
    <PlayerProvider>
      <RouteProvider>
        <Shell />
      </RouteProvider>
    </PlayerProvider>
  )
}

/**
 * 壳层内部 —— 抽屉状态提升到这层；快捷键（Space / F / Ctrl+Alt+D）需要在
 * PlayerContext/RouteContext 内部才能拿到播放器与路由。
 */
function Shell() {
  const [drawer, setDrawer] = useState<'lyrics' | 'queue' | null>(null)

  useShortcuts()

  return (
    <>
      <Bootstrap />
      <PlaybackHistoryBridge />
      <DesktopLyricsBridge />
      <MediaSessionBridge />
      <UpdateDialog />
      <div className="flex h-screen w-screen flex-col overflow-hidden select-none">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <MainContent />
        </div>
        <PlayerBar drawer={drawer} onDrawerChange={setDrawer} />
      </div>
    </>
  )
}
