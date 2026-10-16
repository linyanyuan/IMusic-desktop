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

// 显卡规避开关（2026-10 排查机器蓝屏时加，默认关闭，不影响产品行为）：
// 本机蓝屏 bugcheck 0x119 VIDEO_SCHEDULER_INTERNAL_ERROR（子码 0x3000）是**显卡驱动 /
// 内核视频调度器的缺陷** —— 用户态进程只能「触发」不可能「造成」。触发点集中在
// 「一个建过 GPU 队列的进程被销毁」时，所以开发/排查期可以让进程干脆不建 GPU 队列：
//   IMUSIC_DISABLE_GPU=1 npm run dev      （或 npm run dev:nogpu）
//   或直接给 electron.exe 传 --disable-gpu
// 必须放在 app ready 之前调用，否则不生效。
if (process.env.IMUSIC_DISABLE_GPU === '1' || process.argv.includes('--disable-gpu')) {
  app.disableHardwareAcceleration()
  console.log('[imusic] 已按 IMUSIC_DISABLE_GPU / --disable-gpu 关闭硬件加速（软件渲染）')
}

// 必须在 app ready 之前注册特权协议
registerAudioSchemeAsPrivileged()

let mainWindow: BrowserWindow | null = null

/** vite-plugin-electron 在 dev 注入的 dev server 地址；非空即 development 模式 */
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? ''
const isDev = devServerUrl !== ''

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
      // 仅 dev 关闭 webSecurity —— dev 页面是真实 web origin（http://localhost:5173），
      // 未带 Access-Control-Allow-Origin 的音源接口（music.163.com / api.bilibili.com /
      // gateway.karpov.cn）会被 CORS 直接拦死；打包版走 file://，Electron 不对 file 页面
      // 施加 CORS，两边网络语义不一致，现象就是「dev 下请求不到数据、打包版正常」。
      // 打包与 QA（launch-app.cjs）不设 VITE_DEV_SERVER_URL，webSecurity 仍为 true。
      webSecurity: !isDev,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // B 站等音源域名请求头注入（必须在加载页面前完成）
  setupSourceHeaders()

  if (isDev) {
    mainWindow.loadURL(devServerUrl)
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
  // 必须打印：拿不到锁时进程会以状态码 0 静默退出，终端只看到「启动了但立刻退出」
  // 而没有任何线索（dev 脚本重复启动、或打包版没退出时最容易撞上）。
  console.log('[imusic] 另一个 IMusic 实例已在运行（单实例锁未获取到），本次启动退出。')
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
