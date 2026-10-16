export {}

declare global {
  interface Window {
    imusicAPI?: {
      winMinimize: () => Promise<void>
      winMaximize: () => Promise<void>
      winClose: () => Promise<void>
      winIsMaximized: () => Promise<boolean>
      cacheStats: () => Promise<{ fileCount: number; totalBytes: number; directory: string }>
      cacheClear: () => Promise<{ removed: number; freedBytes: number }>
      /** 下发缓存目录；null/空串表示恢复默认。resolve 生效后的绝对路径 */
      cacheSetDirectory: (dir: string | null) => Promise<string>
      /** 按 mtime 清理超过 maxAgeMs 的缓存条目 */
      cacheClearExpired: (maxAgeMs: number) => Promise<{ removed: number }>
      /** 播放前的轻量命中检查（只 stat，不做 sha256）；未命中 resolve null */
      cacheLookup: (id: string) => Promise<{ url: string; bytes: number } | null>
      /** 离线缓存列表，按入库时间（cachedAt）倒序 */
      cacheList: () => Promise<CachedTrack[]>
      /** 删除某曲的缓存文件 + 校验 receipt + 索引项；返回之前是否存在 */
      cacheRemove: (id: string) => Promise<boolean>
      /** 下载并入库；resolve 可直接喂给 <audio> 的 imusic-audio:// URL */
      cacheDownload: (
        meta: { id: string; title: string; artist: string; source: string },
        url: string,
        headers: Record<string, string>,
      ) => Promise<{ url: string; bytes: number }>
      /** 下发全局热键 accelerator 表（动作名 → Electron accelerator）；null 全部注销 */
      shortcutsRegister: (
        accelerators: Record<string, string> | null,
      ) => Promise<{ failed: string[] }>
      /** 监听主进程全局热键触发的动作名；返回退订函数 */
      onShortcut: (callback: (action: string) => void) => () => void

      // ---- 更新检查（主进程实现，见 electron/update.ts） ----
      /** 当前版本与 manifest 地址 */
      updateInfo: () => Promise<{ currentVersion: string; manifestUrl: string }>
      /** 检查更新；manual=true 跳过 24h 节流。remote=null 表示未取到/无效清单，error 为失败原因 */
      updateCheck: (manual: boolean) => Promise<{
        currentVersion: string
        remote: UpdateManifest | null
        available: boolean
        error: string | null
      }>
      /** 下载并校验 sha256，resolve 本地安装包路径 */
      updateDownload: (manifest: UpdateManifest) => Promise<{ filePath: string }>
      /** 拉起安装器并退出当前进程；正常情况不会 resolve */
      updateInstall: (filePath: string) => Promise<{ ok: boolean }>
      /** 取消进行中的下载 */
      updateCancel: () => Promise<{ ok: boolean }>
      /** 下载进度；返回退订函数 */
      onUpdateProgress: (
        callback: (progress: { received: number; total: number | null }) => void,
      ) => () => void

      // ---- 独立桌面歌词窗口（主进程实现，见 electron/lyricsWindow.ts） ----
      /** 开关歌词窗口；resolve 为切换后的开启状态 */
      lyricsToggle: () => Promise<boolean>
      lyricsIsOpen: () => Promise<boolean>
      /** 主窗口：推送播放状态到歌词窗口 */
      lyricsSendState: (state: DesktopLyricsState) => void
      /** 歌词窗口：回发控制命令到主窗口 */
      lyricsSendCommand: (command: DesktopLyricsCommand) => void
      /** 歌词窗口：订阅播放状态；返回退订函数 */
      onLyricsState: (callback: (state: DesktopLyricsState) => void) => () => void
      /** 主窗口：订阅歌词窗口回发的控制命令；返回退订函数 */
      onLyricsCommand: (callback: (command: DesktopLyricsCommand) => void) => () => void
      /** 主窗口：歌词窗口开关状态变化；返回退订函数 */
      onLyricsToggled: (callback: (open: boolean) => void) => () => void

      // ---- 视图前进/后退（鼠标侧键由主进程 app-command 转发） ----
      /** 主窗口：订阅前进/后退请求；返回退订函数 */
      onNavHistory: (callback: (direction: 'back' | 'forward') => void) => () => void
    }
  }

  /** 一条离线缓存记录（cache-index.json 的一项，见 electron/audioCache.ts） */
  interface CachedTrack {
    id: string
    title: string
    artist: string
    source: string
    bytes: number
    /** 入库时间（epoch ms） */
    cachedAt: number
  }

  interface UpdateManifest {
    version: string
    downloadUrl: string
    sha256: string
    changelog: string | null
  }

  /** 主窗口 → 歌词窗口的播放状态（经主进程转发） */
  interface DesktopLyricsState {
    song: Record<string, unknown> | null
    lyrics: string
    currentTime: number
    duration: number
    isPlaying: boolean
    /** 设置页歌词字号（默认 22） */
    fontSize: number
    /** 设置页歌词高亮颜色（0xAARRGGBB，默认 0xFF1ED760） */
    colorValue: number
    /** 当前曲是否已收藏（收藏按钮高亮） */
    isFavorite: boolean
    /** 是否有当前曲可收藏 */
    canFavorite: boolean
  }

  /** 歌词窗口 → 主窗口的控制命令（对照 Flutter lyrics_window_channel） */
  type DesktopLyricsCommand = 'togglePlay' | 'prev' | 'next' | 'toggleFavorite'
}
