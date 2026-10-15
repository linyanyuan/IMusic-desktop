// ChKSz 音源取证：设置页填了 key 之后，「ChKSz」检索 tab 到底发生了什么。
//
// 背景（用户反馈）：设置页配置 ChKSz key 后搜索功能没打通。
// 本探针对运行中的 Electron 窗口：
//   1. 打开发送一次 ChKSz tab 搜索
//   2. 捕获渲染进程 console（错误会以 [error] 形式出现）
//   3. 捕获网络层里 api.chksz.com 的请求与其结局（成功/失败/被取消）
//   4. 读取 UI 状态（结果行数 / 是否卡在「搜索中…」/ 错误文案）
//
// 用法: node qa/chksz-probe.mjs [cdpPort] [query] [waitMs]

const port = process.argv[2] ?? '9228'
const query = process.argv[3] ?? '周杰伦'
const waitMs = Number(process.argv[4] ?? '16000')
const doPlay = process.argv.includes('play')

// 报告会被原样落盘/入库：apikey、签名(vuutv/vkey/sign…)、令牌等查询参数必须先脱敏，
// 否则真实凭据会随取证 JSON 提交进仓库（并需要轮换）。
const SENSITIVE_QUERY = /\b(apikey|api_key|access_token|token|vuutv|vkey|sign|w_rid|deadline|auth)=([^&\s"'`]+)/gi
function redactSecrets(value) {
  return value.replace(SENSITIVE_QUERY, (_m, key) => `${key}=***REDACTED***`)
}

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
const requests = new Map()
const allRequests = []
const finished = []

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
    consoleLines.push(`[${m.params.type}] ${text}`.slice(0, 400))
  }
  if (m.method === 'Network.requestWillBeSent') {
    const url = m.params.request.url
    allRequests.push(url)
    if (url.includes('chksz')) requests.set(m.params.requestId, url)
  }
  if (m.method === 'Network.responseReceived') {
    const url = m.params.response?.url ?? ''
    if (url.includes('chksz')) {
      finished.push({ url, status: m.params.response.status, kind: 'response' })
    }
  }
  if (m.method === 'Network.loadingFailed') {
    const url = requests.get(m.params.requestId)
    if (url != null) finished.push({ url, error: m.params.errorText, kind: 'failed' })
  }
  const p = pending.get(m.id)
  if (p == null) return
  pending.delete(m.id)
  if (m.error != null) p.rej(new Error(JSON.stringify(m.error)))
  else p.res(m.result)
})
await new Promise((res) => ws.addEventListener('open', res))
await send('Runtime.enable')
await send('Network.enable')

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

/** 不包 async 包装的表达式（用于安装探针）；仍包一层同步函数，允许脚本里写 return */
const evaluateRaw = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression: `(() => { ${expression} })()`,
    returnByValue: true,
  })
  if (result.exceptionDetails != null) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'eval failed')
  }
  return result.result.value
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 音频探针：PlayerContext 用的是脱离 DOM 的 `new Audio()`，必须 hook 构造器才能拿到状态
// （若实例在 hook 之前已建好，下面回退到「网络 + footer」两路证据）
await evaluateRaw(`
  window.__audioLog = []
  const wrap = (el, tag) => {
    if (el == null || el.__wrapped) return el
    el.__wrapped = true
    const rec = { tag, src: el.src, events: [], error: null, readyState: null, networkState: null, currentTime: null, duration: null }
    window.__audioLog.push(rec)
    const sync = () => { rec.src = el.src; rec.readyState = el.readyState; rec.networkState = el.networkState; rec.currentTime = el.currentTime; rec.duration = el.duration; rec.error = el.error ? String(el.error.code) : null }
    for (const ev of ['loadstart','loadedmetadata','play','waiting','loadeddata','canplay','playing','error','stalled']) {
      el.addEventListener(ev, () => { sync(); rec.events.push(ev + '@' + Math.round(performance.now())) })
    }
    return el
  }
  const OrigAudio = window.Audio
  window.Audio = function (...args) { return wrap(new OrigAudio(...args), 'new Audio') }
  window.Audio.prototype = OrigAudio.prototype
  const origCreate = document.createElement.bind(document)
  document.createElement = (tag, ...rest) => wrap(origCreate(tag, ...rest), String(tag).toLowerCase() === 'audio' ? 'audio' : 'other')
  return true
`)

// 1) 进入搜索页并填词
await evaluate(`
  const nav = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '搜索')
  if (nav) nav.click()
  await new Promise(r => setTimeout(r, 600))
  const input = document.querySelector('input[type=search], input[placeholder*="搜索"], input')
  if (!input) throw new Error('没找到搜索框')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(query)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  return true
`)
await wait(4000)

// 2) 点 ChKSz tab（这一步才会真正打 163_search）
await evaluate(`
  const tab = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'ChKSz')
  if (!tab) throw new Error('没找到 ChKSz tab')
  tab.click()
  return true
`)

// 3) 等到有结果、出错、或超时
const deadline = Date.now() + waitMs
let ui = null
while (Date.now() < deadline) {
  ui = await evaluate(`
    const text = document.body.innerText
    return {
      loading: /搜索中/.test(text),
      results: document.querySelectorAll('main .group').length,
      keyMissing: /CHKSZ_KEY_MISSING|未配置 ChKSz|密钥/.test(text),
      errorish: (text.match(/(请求超时|请求失败|密钥无效|未启用|Failed to fetch|ChKSz[^\\n]{0,60})/g) ?? []).slice(0, 4),
      empty: /没有找到|暂无结果|空/.test(text),
    }
  `)
  if (!ui.loading && (ui.results > 0 || ui.keyMissing || ui.errorish.length > 0)) break
  await wait(500)
}

// 4) 可选：双击第一首播放，验证 ChKSz 真能出声（直链透传 + 音质阶梯降级）
let playback = null
if (doPlay && (ui?.results ?? 0) > 0) {
  await evaluate(`
    const row = document.querySelector('main .group')
    if (!row) throw new Error('没有结果行')
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    return true
  `)
  const playDeadline = Date.now() + 25000
  let audio = null
  let playing = false
  let progress = ''
  const timeline = []
  while (Date.now() < playDeadline) {
    // 音频记录按 tag 取（__audioLog 里还有 createElement('div') 这类噪声）
    audio = await evaluate(`
      const list = (window.__audioLog ?? []).filter((r) => r.tag === 'new Audio' || r.tag === 'audio')
      return list.at(-1) ?? null
    `)
    // 播放态判定：**只查播控栏**里的播放/暂停按钮 aria-label。
    // 教训：文档级 `querySelectorAll('button')` 会先命中列表行里的「播放」按钮
    // （搜索结果 20 行就有 20 个），find() 永远返回「播放」，把好好的播放误判为未播放。
    const state = await evaluate(`
      const label = [...document.querySelectorAll('footer button')]
        .map((b) => b.getAttribute('aria-label'))
        .find((l) => l === '暂停' || l === '播放')
      const bar = document.querySelector('footer') ?? document.body
      const text = bar.innerText.split('\\n').slice(0, 6).join(' | ')
      return { label, text }
    `)
    playing = state.label === '暂停'
    progress = state.text
    timeline.push(`${state.label}@${(progress.match(/(\d+:\d\d)/) ?? [])[1] ?? '?'}`)
    if (playing || (audio?.error ?? null) != null) break
    await wait(500)
  }
  const lyricLines = await evaluate(`return document.querySelectorAll('[data-lyric-time]').length`)
  // 歌词抽屉默认关着 —— 点开再数行数（否则永远是 0）
  await evaluate(`
    const btn = [...document.querySelectorAll('footer button')].find((b) => b.getAttribute('aria-label') === '歌词')
    if (btn) btn.click()
    return true
  `)
  await wait(2500)
  const drawerLyricLines = await evaluate(
    `return document.querySelectorAll('[data-lyric-time]').length`,
  )
  playback = {
    audio,
    footer: progress,
    playing,
    lyricLines,
    drawerLyricLines,
    // 播放态时间线：用来发现「音频在放但 isPlaying 为 false」这类 UI 与引擎脱节
    timeline,
    neteaseStreams: allRequests.filter((u) => u.includes('music.126.net')),
  }
}

const report = {
  query,
  ui,
  playback,
  chkszRequests: [...requests.values()],
  chkszOutcomes: finished,
  consoleAll: consoleLines.slice(-40),
  consoleTail: consoleLines.filter((l) => /chksz|ChKSz|CHKSZ/i.test(l)).slice(-12),
  consoleErrorTail: consoleLines.filter((l) => l.startsWith('[error]')).slice(-8),
  verdict: {
    有结果: (ui?.results ?? 0) > 0,
    未卡在搜索中: ui?.loading === false,
    没有请求: (requests.size === 0),
    ...(doPlay
      ? {
          可播放: playback?.playing === true,
          无音频错误: (playback?.audio?.error ?? null) === null,
          走网易云直链: (playback?.neteaseStreams.length ?? 0) > 0,
          有歌词: (playback?.drawerLyricLines ?? 0) > 0,
        }
      : {}),
  },
}
console.log(
  JSON.stringify(
    report,
    (_key, value) => (typeof value === 'string' ? redactSecrets(value) : value),
    2,
  ),
)
ws.close()
