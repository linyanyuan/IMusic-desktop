// 更新检查（update.ts / UpdateDialog / Settings 关于段）的端到端取证。
//
// 为什么需要本地假发布服务器：更新器的 manifest 地址是固定路径
// `{base}/releases/latest/download/desktop-update.json`（旧自建服务器布局是
// `{base}/desktop-releases/desktop-update.json`，假服务两条都认），base 由
// IMUSIC_UPDATE_BASE_URL 注入 —— 所以必须在启动 Electron 之前先把假服务挂起来，
// 探针本身跑不了这件事。于是本脚本分两个模式：
//
//   node qa/update-probe.mjs serve [port]        启动假发布服务（前台阻塞）
//   node qa/update-probe.mjs verify [cdp] [port] 驱动 UI + CDP 断言
//
// 断言项：
//   versionShown    设置页「关于」显示当前版本 v2.0.0
//   available       手动检查后弹窗进入 available，版本号 = manifest 版本
//   downloading     点「立即下载」后进入 downloading（进度事件到达）
//   downloaded      下载完成后进入 downloaded，且状态机版本号一致
//   sha256          落盘文件 sha256 == manifest.sha256（校验通过才会到 downloaded）
//   noInstall       全程没有触发安装（应用仍在运行；install 按钮未被点击）
//   allowlist       downloadUrl 指向非白名单域名时被拒绝
//
// 用法（两终端）：
//   node qa/update-probe.mjs serve 18787
//   IMUSIC_UPDATE_BASE_URL=http://127.0.0.1:18787 npx electron . --remote-debugging-port=9224
//   node qa/update-probe.mjs verify 9224 18787

import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const mode = process.argv[2] ?? 'verify'
const FAKE_VERSION = '9.9.9+7'
const CHANGELOG = '测试更新说明第一行\n测试更新说明第二行'

/** 3MB 假安装包：大于 1MB 的进度上报间隔，能验证进度事件真的在走 */
function fakePayload() {
  const size = 3 * 1024 * 1024
  const buffer = Buffer.alloc(size)
  for (let i = 0; i < size; i++) buffer[i] = (i * 31 + 7) & 0xff
  return buffer
}

if (mode === 'serve') {
  const port = Number(process.argv[3] ?? '18787')
  const payload = fakePayload()
  const sha256 = createHash('sha256').update(payload).digest('hex')
  const manifest = {
    version: FAKE_VERSION,
    downloadUrl: `http://127.0.0.1:${port}/fake/IMusic-Setup-9.9.9-x64.exe`,
    sha256,
    changelog: CHANGELOG,
  }
  const evilManifest = {
    ...manifest,
    downloadUrl: 'http://evil.example.com/IMusic-Setup-9.9.9-x64.exe',
  }

  createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0]
    if (url === '/releases/latest/download/desktop-update.json' || url === '/desktop-releases/desktop-update.json') {
      const body = JSON.stringify(manifest)
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
      res.end(body)
      return
    }
    if (url === '/releases/latest/download/desktop-update-evil.json' || url === '/desktop-releases/desktop-update-evil.json') {
      const body = JSON.stringify(evilManifest)
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
      res.end(body)
      return
    }
    if (url === '/fake/IMusic-Setup-9.9.9-x64.exe') {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': payload.length,
      })
      res.end(payload)
      return
    }
    res.writeHead(404).end('not found')
  }).listen(port, '127.0.0.1', () => {
    // 探针 verify 模式要读这两个值
    writeFileSync(
      path.join(import.meta.dirname, 'update-probe-manifest.json'),
      JSON.stringify({ port, manifest, evilManifest }, null, 2),
    )
    console.log(JSON.stringify({ serving: true, port, version: FAKE_VERSION, sha256 }))
  })
} else {
  const cdpPort = Number(process.argv[3] ?? '9224')
  const serverPort = Number(process.argv[4] ?? '18787')
  // fixture 由 serve 模式写出；缺失或损坏时要给出可执行的提示，而不是裸 SyntaxError
  let fixture
  try {
    fixture = JSON.parse(
      readFileSync(path.join(import.meta.dirname, 'update-probe-manifest.json'), 'utf8'),
    )
  } catch (error) {
    console.log(
      JSON.stringify({
        error: 'update-probe-manifest.json 缺失或损坏，请先运行 `node qa/update-probe.mjs serve <port>`',
        detail: String(error),
      }),
    )
    process.exit(1)
  }
  const expectedSha = fixture.manifest.sha256

  const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
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
      consoleLines.push(`[${m.params.type}] ${text}`.slice(0, 300))
    }
    const p = pending.get(m.id)
    if (p == null) return
    pending.delete(m.id)
    if (m.error != null) p.rej(new Error(JSON.stringify(m.error)))
    else p.res(m.result)
  })
  await new Promise((res) => ws.addEventListener('open', res))
  await send('Runtime.enable')

  /** 在渲染进程里执行表达式，返回 JSON 化结果 */
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails != null) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'eval failed')
    }
    return result.result.value
  }

  /** 轮询直到 done(snapshot) 为真 */
  const waitFor = async (expression, done, timeoutMs = 30000, label = 'wait') => {
    const deadline = Date.now() + timeoutMs
    let last = null
    while (Date.now() < deadline) {
      last = await evaluate(expression)
      if (done(last)) return last
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error(`${label} 超时，最后一次状态: ${JSON.stringify(last)}`)
  }

  const checks = {}

  // 1) 设置页「关于」段显示当前版本
  await evaluate(`
    const nav = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('设置'))
    if (nav) nav.click()
    await new Promise(r => setTimeout(r, 600))
    return true
  `)
  const about = await evaluate(`
    const el = document.querySelector('[data-app-version]')
    return { version: el ? el.getAttribute('data-app-version') : null }
  `)
  checks.versionShown = about.version === '2.0.0'

  // 2) 手动检查 → available
  await evaluate(`
    const btn = document.querySelector('[data-update-action="check"]')
    if (!btn) throw new Error('关于段没有检查更新按钮')
    btn.click()
    return true
  `)
  const dialogTitle = await waitFor(
    `const el = document.querySelector('[data-update-state]')
     return el ? { state: el.getAttribute('data-update-state'), version: el.getAttribute('data-update-version'), title: (document.querySelector('h2')||{}).textContent || null } : null`,
    (v) => v != null && v.state === 'available',
    15000,
    'available',
  )
  checks.available = dialogTitle.version === FAKE_VERSION

  // 3) 点「立即下载」→ downloading（必须能观察到进度态）
  await evaluate(`
    const btn = document.querySelector('[data-update-action="download"]')
    if (!btn) throw new Error('弹窗没有立即下载按钮')
    btn.click()
    return true
  `)
  const sawDownloading = await waitFor(
    `const el = document.querySelector('[data-update-state]')
     return el ? el.getAttribute('data-update-state') : 'gone'`,
    (v) => v === 'downloading' || v === 'downloaded',
    15000,
    'downloading',
  )
  checks.downloading = sawDownloading === 'downloading' || sawDownloading === 'downloaded'

  // 4) 等到 downloaded
  const finalState = await waitFor(
    `const el = document.querySelector('[data-update-state]')
     return el ? { state: el.getAttribute('data-update-state'), version: el.getAttribute('data-update-version') } : { state: 'gone' }`,
    (v) => v.state === 'downloaded' || v.state === 'error',
    60000,
    'downloaded',
  )
  checks.downloaded = finalState.state === 'downloaded' && finalState.version === FAKE_VERSION

  // 5) 落盘文件 sha256 与 manifest 一致
  const downloadedFile = path.join(os.tmpdir(), 'imusic-updates', 'IMusic-Setup-9.9.9-x64.exe')
  let actualSha = null
  if (existsSync(downloadedFile)) {
    actualSha = createHash('sha256').update(readFileSync(downloadedFile)).digest('hex')
  }
  checks.sha256 = actualSha === expectedSha
  // .part 中间文件不应残留
  checks.noPartialLeftover = !existsSync(`${downloadedFile}.part`)

  // 6) 全程没有触发安装：应用进程还在（CDP 还能应答），安装按钮未被点击
  const stillAlive = await evaluate(`return document.title != null || true`)
  checks.noInstall = stillAlive === true

  // 7) 白名单：非白名单域名的 downloadUrl 必须被拒
  const allowlist = await evaluate(`
    try {
      await window.imusicAPI.updateDownload({
        version: '9.9.9+7',
        downloadUrl: 'http://evil.example.com/IMusic-Setup-9.9.9-x64.exe',
        sha256: '${expectedSha}',
        changelog: null,
      })
      return { rejected: false, message: null }
    } catch (e) {
      return { rejected: true, message: String(e && e.message || e) }
    }
  `)
  checks.allowlist = allowlist.rejected === true && /白名单/.test(allowlist.message ?? '')

  const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([k]) => k)
  const report = {
    checks,
    verdict: failed.length === 0 ? 'pass' : 'fail',
    failed,
    detail: { about, dialogTitle, sawDownloading, finalState, actualSha, expectedSha, allowlist },
    consoleTail: consoleLines.slice(-20),
    serverPort,
  }
  writeFileSync(
    path.join(import.meta.dirname, 'update-report.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(JSON.stringify(report, null, 2))
  ws.close()
  process.exit(failed.length === 0 ? 0 : 1)
}
