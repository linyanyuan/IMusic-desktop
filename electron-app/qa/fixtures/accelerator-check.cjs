/**
 * 环境取证：本机有哪些 **全局** accelerator 能真正注册？
 *
 * 独立 Electron 主进程，不加载应用（不读 localStorage、不注册应用热键）。
 *
 * ⚠️ 必须在 **应用关闭** 的情况下运行：
 *   本应用自己就持有 Dart 默认的 7 条 Ctrl+Alt+* 全局热键（只要它在跑）。
 *   如果带着应用取证，这 7 条会被记成 available=false，看上去像「被其他程序占用」，
 *   2026-10 曾因此误判为「本机 Ctrl+Alt+字母 被系统占用」（真实原因是应用自身持有）。
 *   输出里的 appInstances 就是防这个坑：不为 0 时本次结果不可作为环境基线。
 *
 * 用法：npx electron qa/fixtures/accelerator-check.cjs
 * 输出：最后一行 ACCEL_JSON:{first:{...},second:{...},appInstances:N,at:'...'}
 */
const { app, globalShortcut } = require('electron')
const { execFileSync } = require('node:child_process')

/** 当前有几个带窗口的 Electron 进程（= 本应用在跑的数量；本脚本自己无窗口） */
function appInstanceCount() {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "@(Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' }).Count",
      ],
      { encoding: 'utf8' },
    )
    return Number.parseInt(out.trim(), 10) || 0
  } catch {
    return -1 // 检测失败：未知，别当成 0
  }
}

const CANDIDATES = [
  // Dart 默认的 7 条全局热键
  'CommandOrControl+Alt+P',
  'CommandOrControl+Alt+Left',
  'CommandOrControl+Alt+Right',
  'CommandOrControl+Alt+Up',
  'CommandOrControl+Alt+Down',
  'CommandOrControl+Alt+M',
  'CommandOrControl+Alt+D',
  // 备选：带 Shift 的同位键
  'CommandOrControl+Alt+Shift+P',
  'CommandOrControl+Alt+Shift+M',
  'CommandOrControl+Alt+Shift+D',
  'CommandOrControl+Alt+Shift+Left',
  'CommandOrControl+Alt+Shift+Right',
  'CommandOrControl+Alt+Shift+Up',
  'CommandOrControl+Alt+Shift+Down',
  'CommandOrControl+Shift+P',
  'CommandOrControl+Shift+D',
  'CommandOrControl+Shift+M',
]

app.disableHardwareAcceleration()

app.whenReady().then(() => {
  const results = {}
  for (const accelerator of CANDIDATES) {
    let ok = false
    try {
      ok = globalShortcut.register(accelerator, () => {})
    } catch {
      ok = false
    }
    results[accelerator] = ok
  }
  // 再注册一次，区分「被外部占用」与「被本进程已注册」
  const second = {}
  for (const accelerator of CANDIDATES) {
    let ok = false
    try {
      ok = globalShortcut.register(accelerator, () => {})
    } catch {
      ok = false
    }
    second[accelerator] = ok
  }
  console.log(
    'ACCEL_JSON:' +
      JSON.stringify({ first: results, second, appInstances: appInstanceCount(), at: new Date().toISOString() }),
  )
  globalShortcut.unregisterAll()
  app.exit(0)
})
