/**
 * 占用探测：**应用运行时**，独立进程还能注册哪些键？
 *
 * 用途：分辨「某个键是被外部程序占用，还是被本应用自己占用」——
 *   本应用只应占有 7 条 Ctrl+Alt+* 全局热键（再加上用户在设置页改绑的组合）；
 *   裸键（Space / F）属于「应用内」作用域，绝不能走 globalShortcut。
 *
 * 2026-10 的真实教训：应用曾把 scope='inApp' 的动作也推给主进程注册，
 * 于是 Space / F 被 OS 级抢走 —— 独立进程注册它们必然失败，而设置页却
 * 不显示任何「被占用」标记（推进去的就是全部动作）。这里裸键必须 true。
 *
 * 用法（应用在跑）：npx electron qa/fixtures/key-owner-check.cjs
 * 输出：最后一行 KEYOWNER_JSON:{bare:{...},combos:{...},appInstances:N}
 *   bare  : 无修饰键，应全部可注册（true = 应用没抢）
 *   combos: 带修饰组合，应用持有的应为 false（如 Ctrl+Alt+P）
 */
const { app, globalShortcut } = require('electron')
const { execFileSync } = require('node:child_process')

const BARE = ['Space', 'F', 'M', 'P', 'D']
const COMBOS = ['Ctrl+Alt+P', 'Ctrl+Alt+D', 'Ctrl+Alt+Shift+F', 'Ctrl+Shift+F']

function tryRegister(accelerator) {
  try {
    return globalShortcut.register(accelerator, () => {}) === true
  } catch {
    return false
  }
}

/** 带窗口的 Electron 进程数 = 本应用在跑的实例数（本脚本自己无窗口） */
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
    return -1
  }
}

app.disableHardwareAcceleration()

app.whenReady().then(() => {
  const bare = {}
  for (const a of BARE) bare[a] = tryRegister(a)
  const combos = {}
  for (const a of COMBOS) combos[a] = tryRegister(a)
  console.log('KEYOWNER_JSON:' + JSON.stringify({ bare, combos, appInstances: appInstanceCount() }))
  globalShortcut.unregisterAll()
  app.exit(0)
})
