/**
 * 独立桌面歌词窗口 —— 对应 Flutter 端 desktop_multi_window 歌词子窗口
 * （main.dart 的 WindowController 分流 + Win32 透明/置顶工具窗）。
 *
 * 形态：透明无边框置顶小窗（约 760x120 的歌词条），可拖动、可缩放，
 * 不进任务栏；内容来自主窗口渲染进程经主进程转发的播放状态
 * （歌曲 / 歌词 / 进度 / 播放态），窗口内的控制按钮（上一首/播放/下一首）
 * 反向回发给主窗口执行。
 *
 * 开关入口：全局热键 Ctrl+Alt+D（Dart 默认）、播控栏的桌面歌词按钮、
 * preload 的 imusicAPI.lyricsToggle()。
 */

import { BrowserWindow, ipcMain, screen } from 'electron'
import path from 'node:path'

const LYRICS_HASH = '#/lyrics-window'

export interface LyricsWindowIpcOptions {
  currentDir: string
  getMainWindow: () => BrowserWindow | null
}

export function registerLyricsWindowIpc(options: LyricsWindowIpcOptions): void {
  let lyricsWindow: BrowserWindow | null = null
  let boundMain: BrowserWindow | null = null

  const isOpen = (): boolean => lyricsWindow !== null && !lyricsWindow.isDestroyed()

  /**
   * 把「主窗口关闭时一并关掉歌词窗」绑定到**当前**主窗口。
   * 不能在 registerLyricsWindowIpc 时取一次：它在模块加载期就被调用，
   * 而 createWindow() 发生在 app.whenReady 之后，那时 getMainWindow() 还是 null，
   * 会导致绑定丢失（macOS 下主窗关闭后歌词窗成为孤儿）。
   */
  const bindMainWindowClose = (): void => {
    const main = options.getMainWindow()
    if (main === null || main === boundMain) return
    boundMain = main
    main.once('closed', () => {
      boundMain = null
      close()
    })
  }

  const notifyToggled = (): void => {
    options.getMainWindow()?.webContents.send('imusic:lyricsToggled', isOpen())
  }

  const open = (): void => {
    if (isOpen()) {
      lyricsWindow?.focus()
      return
    }
    // 主窗已存在，确保「主窗关闭 → 歌词窗关闭」已绑定
    bindMainWindowClose()

    // 放在主窗口同一屏幕的底部居中（默认位置；用户可拖走）
    const anchor = options.getMainWindow()?.getBounds()
    const display = anchor != null ? screen.getDisplayMatching(anchor) : screen.getPrimaryDisplay()
    const area = display.workArea
    const width = 760
    const height = 120
    const x = Math.round(area.x + (area.width - width) / 2)
    const y = Math.round(area.y + area.height - height - 64)

    lyricsWindow = new BrowserWindow({
      width,
      height,
      x,
      y,
      minWidth: 480,
      minHeight: 80,
      maxHeight: 320,
      transparent: true, // 透明底 + 圆角歌词条（对应 Win32 透明工具窗）
      frame: false,
      resizable: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(options.currentDir, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    // 置顶到 screen-saver 层（对应 Flutter 的 topmost），覆盖全屏应用
    lyricsWindow.setAlwaysOnTop(true, 'screen-saver')
    lyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // 歌词窗不需要菜单栏/任务栏条目
    lyricsWindow.setMenuBarVisibility(false)

    lyricsWindow.once('ready-to-show', () => {
      lyricsWindow?.showInactive()
      notifyToggled()
    })

    const devUrl = process.env.VITE_DEV_SERVER_URL
    if (devUrl !== undefined && devUrl !== '') {
      void lyricsWindow.loadURL(`${devUrl}${LYRICS_HASH}`)
    } else {
      void lyricsWindow.loadFile(path.join(options.currentDir, '../dist/index.html'), {
        hash: LYRICS_HASH,
      })
    }

    lyricsWindow.on('closed', () => {
      lyricsWindow = null
      notifyToggled()
    })
  }

  const close = (): void => {
    if (isOpen()) lyricsWindow?.close()
  }

  /** 切换；返回切换后的开启状态 */
  const toggle = (): boolean => {
    if (isOpen()) {
      close()
      return false
    }
    open()
    return true
  }

  ipcMain.handle('imusic:lyricsToggle', () => toggle())
  ipcMain.handle('imusic:lyricsIsOpen', () => isOpen())

  // 主窗口渲染进程 → 歌词窗口（播放状态转发；带节流的低频小包）
  ipcMain.on('imusic:lyricsState', (_event, state: unknown) => {
    if (isOpen()) lyricsWindow?.webContents.send('imusic:lyricsState', state)
  })

  // 歌词窗口 → 主窗口（控制命令：togglePlay / prev / next）
  ipcMain.on('imusic:lyricsCommand', (_event, command: unknown) => {
    options.getMainWindow()?.webContents.send('imusic:lyricsCommand', command)
  })
}
