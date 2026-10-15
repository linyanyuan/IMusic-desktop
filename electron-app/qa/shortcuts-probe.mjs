// 快捷键能力取证（Flutter desktop_shortcut_controller.dart / settings_shortcuts_section.dart 的 Electron 等价实现）
//
// 判定项：
//   settingsTable   = 设置页渲染出全部 9 条快捷键行（含作用域与键位文案）+ 全局热键开关
//   registrationUi  = 主进程注册失败的热键在设置页被标红（「已被其他程序占用」）—— 且标红集合
//                     与 qa/fixtures/accelerator-check.cjs 的独立环境取证结果一致
//   inAppFocusKey   = CDP 真实按键 F → 应用内快捷键 → 进入专注模式
//   inAppSpaceKey   = 播放中按空格 → 暂停 → 再按 → 继续（真实按键，非 JS 合成事件）
//   rebind          = 点键帽录制 + 真实按键改绑（含录制期间应用内快捷键屏蔽）
//   globalHotkey    = 真实 OS 级热键（PowerShell SendKeys）触发主进程 globalShortcut
//                     → 回传动作名 → 歌词抽屉开/关
//   globalHotkeysEnabled = 「启用全局热键」关闭后热键被注销、重开后恢复
//   resetDefault    = 「恢复默认」把键位还原为 Dart 默认值
//
// 注意：本探针不通过应用自身的 shortcutsRegister 去探测候选键位可用性——那会顶掉
// 应用自己的注册表（applyGlobalShortcuts 是「替换」语义），从而把真实的注册失败藏掉。
// 环境可用性一律以独立主进程取证 qa/fixtures/accelerator-check.cjs 为准。
//
// 用法: node qa/shortcuts-probe.mjs [port]
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const port = process.argv[2] ?? '9222'
const repoRoot = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('about:blank'))
if (page == null) {
  console.log(JSON.stringify({ error: 'no page target' }))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const consoleLines = []

const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const my = ++id
    pending.set(my, { res, rej })
    ws.send(JSON.stringify({ id: my, method, params }))
  })

ws.addEventListener('message', (ev) => {
  let m
  try {
    m = JSON.parse(ev.data)
  } catch {
    return
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args ?? [])
      .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? a.type)))
      .join(' ')
    consoleLines.push(`[${m.params.type}] ${text}`.slice(0, 200))
  }
  const p = pending.get(m.id)
  if (p == null) return
  pending.delete(m.id)
  if (m.error != null) p.rej(new Error(JSON.stringify(m.error)))
  else p.res(m.result)
})

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  })
  if (r.exceptionDetails != null) {
    throw new Error(JSON.stringify(r.exceptionDetails.exception ?? r.exceptionDetails))
  }
  return r.result?.value
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 }

/** CDP 真实按键（isTrusted=true，走浏览器输入管线，非 JS dispatchEvent） */
const realKey = async (key, code, vk, opts = {}) => {
  const base = {
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    modifiers: opts.modifiers ?? 0,
  }
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  if (opts.text != null) {
    await send('Input.dispatchKeyEvent', { type: 'char', text: opts.text, ...base })
  }
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

/** 真 OS 级热键：PowerShell SendKeys。combo 例: '^%+d' = Ctrl+Alt+Shift+D */
const sendGlobalHotkey = (combo) => {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${combo}')`,
    ],
    { stdio: 'pipe' },
  )
}

const MODS = MOD.ctrl | MOD.alt | MOD.shift

const drawerOpen = `document.querySelector('button[aria-label="关闭抽屉"]') != null`
const bindingLabel = (action) =>
  `document.querySelector('[data-shortcut-action="${action}"]')?.textContent?.trim() ?? null`
const unavailableBadges = `Array.from(document.querySelectorAll('[data-shortcut-unavailable]')).map(e => e.dataset.shortcutUnavailable)`

const report = { port }

// Dart 默认的 7 条全局热键 → accelerator（与 services/shortcutSettings.ts 的默认值对应）
const DEFAULT_GLOBAL_ACCELERATORS = {
  playPauseGlobal: 'CommandOrControl+Alt+P',
  previousTrack: 'CommandOrControl+Alt+Left',
  nextTrack: 'CommandOrControl+Alt+Right',
  volumeUp: 'CommandOrControl+Alt+Up',
  volumeDown: 'CommandOrControl+Alt+Down',
  mute: 'CommandOrControl+Alt+M',
  toggleDesktopLyrics: 'CommandOrControl+Alt+D',
}

/** 读独立取证结果（缺失时现场跑一次）；返回 { available: [], busy: [], appInstances, at } */
function envAcceleratorGroundTruth() {
  const path = new URL('./accelerator-availability.json', import.meta.url)
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    execFileSync('npx', ['electron', 'qa/fixtures/accelerator-check.cjs'], {
      cwd: repoRoot,
      shell: true,
      stdio: 'pipe',
    })
    raw = readFileSync(path, 'utf8')
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`accelerator-availability.json 解析失败: ${e?.message ?? e}`)
  }
  const first = parsed?.first ?? {}
  return {
    available: Object.keys(first).filter((k) => first[k]),
    busy: Object.keys(first).filter((k) => !first[k]),
    appInstances: parsed?.appInstances ?? -1,
    at: parsed?.at ?? null,
  }
}

/**
 * 运行中的应用此刻占着哪些键？（本 bug 的回归探针）
 *
 * 若主进程把「应用内」动作（Space / F 这类无修饰单键）也拿去 globalShortcut，
 * 这些键会被 OS 级抢走 —— 独立进程注册它们必然失败。所以裸键必须全部可注册。
 */
function keyOwnershipWhileAppRuns() {
  const out = execFileSync('npx', ['electron', 'qa/fixtures/key-owner-check.cjs'], {
    cwd: repoRoot,
    shell: true,
    encoding: 'utf8',
  })
  const line = out.split(/\r?\n/).find((l) => l.startsWith('KEYOWNER_JSON:'))
  if (line == null) throw new Error(`key-owner-check 无输出: ${out.slice(-200)}`)
  try {
    return JSON.parse(line.slice('KEYOWNER_JSON:'.length))
  } catch (e) {
    throw new Error(`key-owner-check 输出解析失败: ${e?.message ?? e}`)
  }
}

/** 应用内作用域的动作（不含全局热键） */
const IN_APP_ACTIONS = ['playPauseInApp', 'toggleFocusMode']

/** 改绑测试候选：+Shift 组合不与 Dart 默认热键冲突，语义清晰 */
const REBIND_CANDIDATES = [
  {
    accel: 'CommandOrControl+Alt+Shift+D',
    label: 'Ctrl + Alt + Shift + D',
    key: 'd',
    vk: 68,
    mods: MOD.ctrl | MOD.alt | MOD.shift,
    send: '+^%d',
  },
  {
    accel: 'CommandOrControl+Alt+Shift+M',
    label: 'Ctrl + Alt + Shift + M',
    key: 'm',
    vk: 77,
    mods: MOD.ctrl | MOD.alt | MOD.shift,
    send: '+^%m',
  },
]

ws.addEventListener('open', async () => {
  try {
    await send('Runtime.enable')
    await send('Page.enable')
    // 干净起点：清掉可能残留的键位改动 + 重载
    await evalJs(`localStorage.removeItem('settings_shortcuts'), null`)
    await send('Page.reload', { ignoreCache: false })
    await sleep(4000)

    // ---- 1) 设置页快捷键表 ----
    report.settings = await evalJs(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      Array.from(document.querySelectorAll('aside button'))
        .find((b) => b.textContent.trim() === '设置')?.click()
      await sleep(900)
      const rows = Array.from(document.querySelectorAll('[data-shortcut-action]')).map((el) => ({
        action: el.dataset.shortcutAction,
        label: el.textContent.trim(),
      }))
      const toggle = document.querySelector('[data-testid="shortcut-global-toggle"]')
      window.__shortcutEvents = []
      window.imusicAPI.onShortcut((a) => window.__shortcutEvents.push(a))
      return {
        rowCount: rows.length,
        rows,
        scopes: Array.from(document.querySelectorAll('li')).filter(li => li.querySelector('[data-shortcut-action]')).length,
        globalTogglePresent: toggle != null,
        globalToggleChecked: toggle?.checked ?? null,
        resetButtonPresent: document.querySelector('[data-testid="shortcut-reset"]') != null,
      }
    })()`)

    // ---- 2) 注册失败标记：应与独立取证里「被占用」的默认热键完全一致 ----
    await sleep(1200)
    report.envGroundTruth = envAcceleratorGroundTruth()
    report.registrationUi = await evalJs(`(() => ({
      unavailable: ${unavailableBadges},
      text: document.querySelector('[data-shortcut-unavailable]')?.textContent?.trim() ?? null,
    }))()`)
    report.registrationUi.expectedFromEnvironment = Object.entries(DEFAULT_GLOBAL_ACCELERATORS)
      .filter(([, accel]) => report.envGroundTruth.busy.includes(accel))
      .map(([action]) => action)
    report.registrationUi.matchesEnvironment =
      report.registrationUi.unavailable.length === report.registrationUi.expectedFromEnvironment.length &&
      report.registrationUi.unavailable.every((a) =>
        report.registrationUi.expectedFromEnvironment.includes(a))

    // 改绑测试选用的组合：取证里确认可注册的 +Shift 组合（都不与默认冲突）
    const rebindCandidate =
      REBIND_CANDIDATES.find((c) => report.envGroundTruth.available.includes(c.accel)) ?? null
    report.envCandidates = {
      chosen: rebindCandidate?.accel ?? null,
      availableCDouble: report.envGroundTruth.available.filter((a) => a.endsWith('+D')),
    }

    // ---- 3) 应用内快捷键绝不能注册成系统级热键（本 bug 的回归点） ----
    report.inAppNotGlobal = {
      inAppBadges: report.registrationUi.unavailable.filter((a) => IN_APP_ACTIONS.includes(a)),
      keyOwnership: keyOwnershipWhileAppRuns(),
    }
    report.inAppNotGlobal.bareSpaceFree = report.inAppNotGlobal.keyOwnership?.bare?.Space === true
    report.inAppNotGlobal.bareFFree = report.inAppNotGlobal.keyOwnership?.bare?.F === true
    report.inAppNotGlobal.pass =
      report.inAppNotGlobal.inAppBadges.length === 0 &&
      report.inAppNotGlobal.bareSpaceFree === true &&
      report.inAppNotGlobal.bareFFree === true

    // ---- 4) 应用内快捷键 F → 专注模式 ----
    await evalJs(`document.querySelector('aside button')?.blur(), null`)
    await realKey('f', 'KeyF', 70, { text: 'f' })
    await sleep(900)
    report.inAppFocusKey = await evalJs(
      `({ focusView: document.querySelector('[data-testid="focus-view"]') != null })`,
    )
    await evalJs(`document.querySelector('[data-testid="focus-exit"]')?.click(), null`)
    await sleep(700)

    // ---- 5) 应用内快捷键 空格 → 播放/暂停 ----
    report.space = await evalJs(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const navText = (label) => Array.from(document.querySelectorAll('aside button'))
        .find((b) => b.textContent.trim() === label)
      const byAria = (label) => Array.from(document.querySelectorAll('footer button'))
        .find((b) => b.getAttribute('aria-label') === label)
      const rowsNow = () => Array.from(document.querySelectorAll('main .group.flex.items-center'))
      const setNative = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      const isPlaying = () => byAria('暂停') != null

      navText('搜索')?.click(); await sleep(500)
      const input = document.querySelector('main input[placeholder*="搜索"]')
      if (input == null) return { error: 'no search input' }
      setNative.call(input, '周杰伦')
      input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(200)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      for (let i = 0; i < 60; i++) { await sleep(500); if (rowsNow().length > 0) break }
      const rows = rowsNow()
      if (rows.length === 0) return { error: 'no search results' }
      Array.from(rows[0].querySelectorAll('button'))
        .find((b) => (b.getAttribute('aria-label') ?? '').startsWith('播放'))?.click()
      for (let i = 0; i < 60; i++) { await sleep(500); if (isPlaying()) break }
      document.activeElement?.blur?.()
      return { started: isPlaying(), title: document.querySelector('footer .truncate')?.textContent?.trim() ?? null }
    })()`)

    if (report.space?.started === true) {
      await evalJs(`document.activeElement?.blur?.(), null`)
      await realKey(' ', 'Space', 32, { text: ' ' })
      await sleep(900)
      report.spaceAfterFirstPress = await evalJs(
        `Array.from(document.querySelectorAll('footer button')).some(b => b.getAttribute('aria-label') === '播放')`,
      )
      await realKey(' ', 'Space', 32, { text: ' ' })
      await sleep(900)
      report.spaceAfterSecondPress = await evalJs(
        `Array.from(document.querySelectorAll('footer button')).some(b => b.getAttribute('aria-label') === '暂停')`,
      )
      // 暂停掉，避免后台播放干扰
      await realKey(' ', 'Space', 32, { text: ' ' })
      await sleep(600)
    }

    // ---- 6) 录制 + 改绑（同时验证录制期应用内快捷键屏蔽） ----
    const targetAction = 'toggleDesktopLyrics'
    const chosenKey = rebindCandidate?.key ?? 'd'
    const chosenMods = rebindCandidate?.mods ?? null
    const chosenSendKeys = rebindCandidate?.send ?? null

    report.rebind = { chosen: rebindCandidate?.accel ?? null }
    if (rebindCandidate != null) {
      // 回到设置页（空格测试把导航切到了搜索）
      await evalJs(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
        Array.from(document.querySelectorAll('aside button'))
          .find((b) => b.textContent.trim() === '设置')?.click()
        await sleep(900)
        return true
      })()`)
      // 6a) 进入录制 → 按 F（应用内专注模式键）：应被屏蔽，且不写入绑定
      await evalJs(
        `document.querySelector('[data-shortcut-action="${targetAction}"]').click(), null`,
      )
      await sleep(300)
      report.rebind.recordingLabel = await evalJs(bindingLabel(targetAction))
      await realKey('f', 'KeyF', 70, { modifiers: MODS, text: 'f' })
      await sleep(700)
      report.rebind.afterFWhileRecording = await evalJs(`(() => ({
        label: ${bindingLabel(targetAction)},
        focusView: document.querySelector('[data-testid="focus-view"]') != null,
      }))()`)
      // 6b) 改成可用组合
      await evalJs(
        `document.querySelector('[data-shortcut-action="${targetAction}"]').click(), null`,
      )
      await sleep(300)
      await realKey(chosenKey, `Key${chosenKey.toUpperCase()}`, rebindCandidate.vk, {
        modifiers: chosenMods,
        text: chosenKey,
      })
      await sleep(1200)
      report.rebind.afterRebind = await evalJs(`(() => ({
        label: ${bindingLabel(targetAction)},
        unavailable: ${unavailableBadges},
        stored: JSON.parse(localStorage.getItem('settings_shortcuts') ?? '{}').shortcuts?.${targetAction} ?? null,
      }))()`)

      // ---- 7) 真 OS 热键（改绑后的组合）→ 主进程 → 渲染进程 ----
      const drawerBefore = await evalJs(drawerOpen)
      try {
        sendGlobalHotkey(chosenSendKeys)
      } catch (e) {
        report.globalHotkeyError = String(e?.message ?? e).slice(0, 200)
      }
      await sleep(1800)
      report.globalHotkey = await evalJs(
        `({ events: window.__shortcutEvents ?? [], drawerOpen: ${drawerOpen} })`,
      )
      report.globalHotkey.drawerWasClosedBefore = drawerBefore === false
      report.globalHotkey.toggled = drawerBefore === false ? report.globalHotkey.drawerOpen : null
      await evalJs(`document.querySelector('button[aria-label="关闭抽屉"]')?.click(), null`)
      await sleep(400)

      // ---- 7b) 「启用全局热键」开关：关闭后应注销（OS 热键不再触发），重开后再生效 ----
      await evalJs(`(() => {
        window.__shortcutEvents = []
        const t = document.querySelector('[data-testid="shortcut-global-toggle"]')
        if (t?.checked === true) t.click()
        return t?.checked ?? null
      })()`)
      await sleep(1200)
      report.globalToggleOff = { checked: await evalJs(
        `document.querySelector('[data-testid="shortcut-global-toggle"]')?.checked ?? null`,
      ) }
      try {
        sendGlobalHotkey(chosenSendKeys)
      } catch (e) {
        report.globalToggleOff.error = String(e?.message ?? e).slice(0, 120)
      }
      await sleep(1500)
      report.globalToggleOff.eventsWhileDisabled = await evalJs(`window.__shortcutEvents ?? []`)
      report.globalToggleOff.drawerOpen = await evalJs(drawerOpen)

      await evalJs(`(() => {
        const t = document.querySelector('[data-testid="shortcut-global-toggle"]')
        if (t?.checked === false) t.click()
        return t?.checked ?? null
      })()`)
      await sleep(1200)
      report.globalToggleOn = { checked: await evalJs(
        `document.querySelector('[data-testid="shortcut-global-toggle"]')?.checked ?? null`,
      ) }
      await evalJs(`window.__shortcutEvents = [], null`)
      try {
        sendGlobalHotkey(chosenSendKeys)
      } catch (e) {
        report.globalToggleOn.error = String(e?.message ?? e).slice(0, 120)
      }
      await sleep(1500)
      report.globalToggleOn.events = await evalJs(`window.__shortcutEvents ?? []`)
      await evalJs(`document.querySelector('button[aria-label="关闭抽屉"]')?.click(), null`)
      await sleep(400)
    }

    // ---- 8) 恢复默认 ----
    await evalJs(`document.querySelector('[data-testid="shortcut-reset"]')?.click(), null`)
    await sleep(900)
    report.resetDefault = await evalJs(`(() => ({
      lyricsLabel: ${bindingLabel(targetAction)},
      unknownRows: Array.from(document.querySelectorAll('[data-shortcut-action]'))
        .filter((el) => el.textContent.trim() === '未设置').length,
    }))()`)

    report.console = consoleLines.slice(-12)

    const rows = report.settings?.rows ?? []
    const pass =
      report.settings?.rowCount === 9 &&
      report.settings?.globalTogglePresent === true &&
      report.settings?.resetButtonPresent === true &&
      rows.some((r) => r.action === 'playPauseInApp' && r.label === 'Space') &&
      rows.some((r) => r.action === 'playPauseGlobal' && r.label === 'Ctrl + Alt + P') &&
      report.inAppFocusKey?.focusView === true &&
      report.spaceAfterFirstPress === true &&
      report.spaceAfterSecondPress === true &&
      report.rebind?.afterFWhileRecording?.focusView === false &&
      report.rebind?.afterFWhileRecording?.label === 'Ctrl + Alt + Shift + F' &&
      report.inAppNotGlobal?.pass === true &&
      report.rebind?.afterRebind?.label === rebindCandidate?.label &&
      report.rebind?.afterRebind?.unavailable?.includes(targetAction) === false &&
      report.globalHotkey?.events?.includes('toggleDesktopLyrics') === true &&
      report.globalHotkey?.drawerOpen === true &&
      report.globalToggleOff?.checked === false &&
      report.globalToggleOff?.eventsWhileDisabled?.length === 0 &&
      report.globalToggleOff?.drawerOpen === false &&
      report.globalToggleOn?.checked === true &&
      report.globalToggleOn?.events?.includes('toggleDesktopLyrics') === true &&
      report.resetDefault?.lyricsLabel === 'Ctrl + Alt + D'
    report.verdict = pass ? 'pass' : 'fail'
    console.log(JSON.stringify(report, null, 2))
    ws.close()
    process.exit(pass ? 0 : 2)
  } catch (e) {
    console.log(JSON.stringify({ ...report, error: String(e?.message ?? e).slice(0, 400) }, null, 2))
    process.exit(1)
  }
})
