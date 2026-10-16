/**
 * 启动「真实应用」并开好 CDP 端口 —— 专供 qa/ 自动化验收使用。
 *
 * 与直接 `electron .` 的区别（两个坑，都真实踩过）：
 *  1. 必须走应用自己的 dist-electron/main.js，让窗口按 main.ts 的 ready-to-show 正常显示。
 *     窗口隐藏时 document.visibilityState === 'hidden' → rAF 停发 →
 *     framer-motion 的 AnimatePresence mode="wait" 退出动画永不结束 →
 *     点击侧栏导航「毫无反应」（DOM/React 里其实什么都没发生）。这不是代码回归。
 *  2. 必须把 userData 指到独立目录：打包版与开发版共用 userData 时会撞单实例锁，
 *     `electron .` 会静默 exit 0（表现为「启动即退」，且没有任何报错）。
 *
 * 前置：先产出构建物（npm run build 或 npx vite build，dist/ 与 dist-electron/ 都要）。
 *
 * 用法：
 *   ./node_modules/electron/dist/electron.exe qa/launch-app.cjs [port]
 *   node qa/cdp-eval.mjs "document.querySelector('h1')?.textContent" 9333
 *
 * 环境变量：
 *   IMUSIC_QA_USER_DATA  覆盖隔离的 userData 目录（默认 %TEMP%/imusic-qa-profile）
 *   IMUSIC_UPDATE_BASE_URL 默认 http://127.0.0.1:1（让更新检查静默失败，避免弹窗干扰）
 */
const { app } = require('electron')
const os = require('os')
const path = require('path')

process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.stack))
process.on('unhandledRejection', (e) => console.log('REJECTION', e && e.stack ? e.stack : e))

const port = process.argv[2] ?? '9333'
app.commandLine.appendSwitch('remote-debugging-port', port)
// 隔离 userData：既不撞单实例锁，也不污染开发版/打包版的真实音乐库与设置
app.setPath('userData', process.env.IMUSIC_QA_USER_DATA || path.join(os.tmpdir(), 'imusic-qa-profile'))
// 走 dist/ 静态产物，不要连 dev server
process.env.VITE_DEV_SERVER_URL = ''
process.env.IMUSIC_UPDATE_BASE_URL = process.env.IMUSIC_UPDATE_BASE_URL || 'http://127.0.0.1:1'

require('../dist-electron/main.js')
