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
  /** 播放前轻量命中检查：只 stat 缓存文件，不做 sha256；未命中 resolve null */
  cacheLookup: (id) => ipcRenderer.invoke('imusic:cacheLookup', id),
  /** 离线缓存列表（按入库时间倒序） */
  cacheList: () => ipcRenderer.invoke('imusic:cacheList'),
  /** 删除某曲的缓存文件 + 校验 receipt + 索引项；resolve 之前是否存在 */
  cacheRemove: (id) => ipcRenderer.invoke('imusic:cacheRemove', id),
  /** 下载并入库；resolve 可直接喂给 <audio> 的 imusic-audio:// URL */
  cacheDownload: (meta, url, headers) =>
    ipcRenderer.invoke('imusic:cacheDownload', meta, url, headers),
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
