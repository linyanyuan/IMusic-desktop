/**
 * 【临时调试用，勿提交】带 CDP 的 dev 实例：隔离 userData + 保留 VITE_DEV_SERVER_URL，
 * 并把渲染进程 console / 失败请求打到 stdout，用来定位「请求不到数据」。
 *
 * 与 qa/launch-app.cjs 的区别：那个会强制 VITE_DEV_SERVER_URL='' 走 file:// 静态产物，
 * 这个要连 dev server（http://localhost:5173），所以不能清空它。
 *
 * 用法：VITE_DEV_SERVER_URL=http://localhost:5173 \
 *        IMUSIC_QA_USER_DATA=/d/tmp/... \
 *        ./node_modules/electron/dist/electron.exe qa/dev-cdp-launch.cjs 9444
 */
const { app, session } = require('electron')
const os = require('os')
const path = require('path')

process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.stack))
process.on('unhandledRejection', (e) => console.log('REJECTION', e && e.stack ? e.stack : e))

const port = process.argv[2] ?? '9444'
app.commandLine.appendSwitch('remote-debugging-port', port)
app.setPath('userData', process.env.IMUSIC_QA_USER_DATA || path.join(os.tmpdir(), 'imusic-dev-dbg'))
process.env.IMUSIC_UPDATE_BASE_URL = process.env.IMUSIC_UPDATE_BASE_URL || 'http://127.0.0.1:1'

console.log('[dev-cdp] devUrl =', JSON.stringify(process.env.VITE_DEV_SERVER_URL))
console.log('[dev-cdp] userData =', app.getPath('userData'))

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (...args) => {
    const first = args[0]
    if (args.length === 1 && first && typeof first === 'object' && 'message' in first) {
      console.log(`[renderer:${first.level}] ${first.message} (${first.sourceId}:${first.lineNumber})`)
    } else {
      console.log(`[renderer] level=${args[1]} ${args[2]} (${args[4]}:${args[3]})`)
    }
  })
  win.webContents.on('did-fail-load', (_ev, code, desc, url) =>
    console.log(`[did-fail-load] ${code} ${desc} ${url}`),
  )
})

app.whenReady().then(() => {
  session.defaultSession.webRequest.onErrorOccurred((d) =>
    console.log(`[net-error] ${d.error} ${d.url}`),
  )
  session.defaultSession.webRequest.onCompleted((d) => {
    if (d.statusCode >= 400) console.log(`[net-${d.statusCode}] ${d.url}`)
  })
})

require('../dist-electron/main.js')
