const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('imusicAPI', {
  winMinimize: () => ipcRenderer.invoke('imusic:winMinimize'),
  winMaximize: () => ipcRenderer.invoke('imusic:winMaximize'),
  winClose: () => ipcRenderer.invoke('imusic:winClose'),
  winIsMaximized: () => ipcRenderer.invoke('imusic:winIsMaximized'),
  cacheStats: () => ipcRenderer.invoke('imusic:cacheStats'),
  cacheClear: () => ipcRenderer.invoke('imusic:cacheClear'),
  cacheSetDirectory: (dir) => ipcRenderer.invoke('imusic:cacheSetDirectory', dir),
  cacheClearExpired: (maxAgeMs) => ipcRenderer.invoke('imusic:cacheClearExpired', maxAgeMs),
  /** 下发全局热键 accelerator 表；null 表示全部注销 */
  shortcutsRegister: (accelerators) => ipcRenderer.invoke('imusic:shortcutsRegister', accelerators),
  /** 监听主进程全局热键触发的动作名；返回退订函数 */
  onShortcut: (callback) => {
    const handler = (_event, action) => callback(action)
    ipcRenderer.on('imusic:shortcut', handler)
    return () => ipcRenderer.removeListener('imusic:shortcut', handler)
  },

  // ---- 更新检查（主进程实现，见 electron/update.ts） ----
  updateInfo: () => ipcRenderer.invoke('imusic:updateInfo'),
  updateCheck: (manual) => ipcRenderer.invoke('imusic:updateCheck', manual),
  updateDownload: (manifest) => ipcRenderer.invoke('imusic:updateDownload', manifest),
  updateInstall: (filePath) => ipcRenderer.invoke('imusic:updateInstall', filePath),
  updateCancel: () => ipcRenderer.invoke('imusic:updateCancel'),
  onUpdateProgress: (callback) => {
    const handler = (_event, progress) => callback(progress)
    ipcRenderer.on('imusic:updateProgress', handler)
    return () => ipcRenderer.removeListener('imusic:updateProgress', handler)
  },

  // ---- 独立桌面歌词窗口（见 electron/lyricsWindow.ts） ----
  /** 开关歌词窗口；resolve 为切换后的开启状态 */
  lyricsToggle: () => ipcRenderer.invoke('imusic:lyricsToggle'),
  lyricsIsOpen: () => ipcRenderer.invoke('imusic:lyricsIsOpen'),
  /** 主窗口：推送播放状态（歌曲/歌词/进度/播放态）到歌词窗口 */
  lyricsSendState: (state) => ipcRenderer.send('imusic:lyricsState', state),
  /** 歌词窗口：回发控制命令（togglePlay / prev / next）到主窗口 */
  lyricsSendCommand: (command) => ipcRenderer.send('imusic:lyricsCommand', command),
  /** 歌词窗口：订阅播放状态；返回退订函数 */
  onLyricsState: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('imusic:lyricsState', handler)
    return () => ipcRenderer.removeListener('imusic:lyricsState', handler)
  },
  /** 主窗口：订阅歌词窗口回发的控制命令；返回退订函数 */
  onLyricsCommand: (callback) => {
    const handler = (_event, command) => callback(command)
    ipcRenderer.on('imusic:lyricsCommand', handler)
    return () => ipcRenderer.removeListener('imusic:lyricsCommand', handler)
  },
  /** 主窗口：歌词窗口开关状态变化（用于按钮高亮同步）；返回退订函数 */
  onLyricsToggled: (callback) => {
    const handler = (_event, open) => callback(open)
    ipcRenderer.on('imusic:lyricsToggled', handler)
    return () => ipcRenderer.removeListener('imusic:lyricsToggled', handler)
  },
  /** 主窗口：订阅前进/后退请求（鼠标侧键经主进程 app-command 转发）；返回退订函数 */
  onNavHistory: (callback) => {
    const handler = (_event, direction) => callback(direction)
    ipcRenderer.on('imusic:navHistory', handler)
    return () => ipcRenderer.removeListener('imusic:navHistory', handler)
  },
})
