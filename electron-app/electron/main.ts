import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupSourceHeaders } from './headers'
import { registerAudioCacheHandlers } from './audioCache'
import {
  registerAudioProtocolHandler,
  registerAudioSchemeAsPrivileged,
} from './cacheProtocol'
import { registerWindowIpc } from './windowIpc'
import { registerShortcutIpc, unregisterGlobalShortcuts } from './shortcuts'
import { registerUpdateIpc } from './update'
import { registerLyricsWindowIpc } from './lyricsWindow'

// 主进程以 ESM 打包（package.json "type": "module"），无 __dirname，
// 需从 import.meta.url 推导当前目录。
const currentDir = path.dirname(fileURLToPath(import.meta.url))

// 必须在 app ready 之前注册特权协议
registerAudioSchemeAsPrivileged()

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    frame: false, // 无边框，自绘标题栏
    backgroundColor: '#FFFFFF',
    show: false,
    webPreferences: {
      preload: path.join(currentDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // B 站等音源域名请求头注入（必须在加载页面前完成）
  setupSourceHeaders()

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl !== undefined && devUrl !== '') {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(path.join(currentDir, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 鼠标侧键（XButton1/2）→ 视图前进/后退，转发给渲染进程处理
  mainWindow.on('app-command', (_event, command) => {
    if (command === 'browser-backward') {
      mainWindow?.webContents.send('imusic:navHistory', 'back')
    } else if (command === 'browser-forward') {
      mainWindow?.webContents.send('imusic:navHistory', 'forward')
    }
  })
}

registerWindowIpc(() => mainWindow)
registerAudioCacheHandlers()
registerShortcutIpc()
registerUpdateIpc(() => mainWindow)
registerLyricsWindowIpc({ currentDir, getMainWindow: () => mainWindow })

function bootstrap() {
  app.whenReady().then(() => {
    registerAudioProtocolHandler()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// 单实例锁：桌面端只能有一个进程持有全局热键与 userData 设置文件。
// 没有锁时第二个实例的 globalShortcut 注册会全部失败（表现为「热键被占用」），
// 且两个进程会并发覆写同一份设置/音乐库缓存。
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  // 已有实例被再次启动时，把已有窗口提到前台而不是新开一个
  app.on('second-instance', () => {
    if (mainWindow === null) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  bootstrap()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 退出前释放全局热键，否则进程残留占用（Ctrl+Alt+* 会被其他程序报“已被占用”）
app.on('will-quit', () => {
  unregisterGlobalShortcuts()
})
