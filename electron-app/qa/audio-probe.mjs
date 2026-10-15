// 播放链路取证脚本：注入 Audio 代理 → 重载页面 → 搜索 → 播放 → 导出真实 audio 元素状态/网络/控制台
const port = process.argv[2] ?? '9223'
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('about:blank'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const consoleLines = []
const requests = []
const failed = []

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
      .map((a) => (a.value !== undefined ? String(a.value) : a.description ?? a.type))
      .join(' ')
    consoleLines.push(`[${m.params.type}] ${text}`.slice(0, 300))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleLines.push('[exception] ' + JSON.stringify(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300))
  }
  if (m.method === 'Network.requestWillBeSent') {
    requests.push(m.params.request.url)
  }
  if (m.method === 'Network.loadingFailed') {
    failed.push({ error: m.params.errorText, blocked: m.params.blockedReason ?? null, type: m.params.type })
  }
  const p = pending.get(m.id)
  if (!p) return
  pending.delete(m.id)
  if (m.error) {
    p.rej(new Error(JSON.stringify(m.error)))
  } else {
    p.res(m.result)
  }
})

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception ?? r.exceptionDetails))
  return r.result?.value
}

const INJECT = `
(() => {
  window.__audioLog = []
  const Real = window.Audio
  const wrap = (el, tag) => {
    const rec = { tag, src: el.src, events: [], error: null, readyState: null, networkState: null, currentTime: null, duration: null }
    window.__audioLog.push(rec)
    const sync = () => {
      rec.src = el.src; rec.readyState = el.readyState; rec.networkState = el.networkState
      rec.currentTime = Math.round(el.currentTime * 10) / 10
      rec.duration = Number.isFinite(el.duration) ? Math.round(el.duration * 10) / 10 : null
      if (el.error) rec.error = { code: el.error.code, message: el.error.message }
    }
    for (const evt of ['loadstart','loadedmetadata','loadeddata','canplay','playing','waiting','stalled','suspend','abort','emptied','error','ended','pause','play']) {
      el.addEventListener(evt, () => { sync(); rec.events.push(evt + '@' + Math.round(performance.now())) })
    }
    const origPlay = el.play.bind(el)
    el.play = () => { const p = origPlay(); if (p && p.catch) p.catch(e => { rec.events.push('play-rejected:' + (e && e.message)); sync() }); return p }
    sync()
    return el
  }
  window.Audio = function (...args) { return wrap(new Real(...args), 'new Audio') }
  window.Audio.prototype = Real.prototype
  const origCreate = document.createElement.bind(document)
  document.createElement = function (tag, ...rest) {
    const el = origCreate(tag, ...rest)
    if (String(tag).toLowerCase() === 'audio') wrap(el, 'createElement')
    return el
  }
})()
`

ws.addEventListener('open', async () => {
  try {
    await send('Runtime.enable')
    await send('Page.enable')
    await send('Network.enable')
    await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT })
    await send('Page.reload', { ignoreCache: true })
    await new Promise((r) => setTimeout(r, 3500))

    const res = await evalJs(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      const navBtn = Array.from(document.querySelectorAll('aside button')).find(b => b.textContent.trim() === '搜索')
      if (!navBtn) return { error: 'no search nav' }
      navBtn.click(); await sleep(400)
      const input = document.querySelector('main input[placeholder*="搜索"]')
      if (!input) return { error: 'no search input' }
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '周杰伦')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(200)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      for (let i = 0; i < 40; i++) { await sleep(500); if (document.querySelectorAll('main .group.flex.items-center').length > 0) break }
      const rows = Array.from(document.querySelectorAll('main .group.flex.items-center'))
      const first = rows[0]
      const btn = first && Array.from(first.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === '播放')
      if (!btn) return { error: 'no play button', rows: rows.length }
      btn.click()
      for (let i = 0; i < 16; i++) {
        await sleep(500)
        const footer = document.querySelector('footer')
        if (footer && footer.querySelector('button[aria-label="暂停"]')) break
      }
      const footer = document.querySelector('footer')
      return {
        resultCount: rows.length,
        playBtn: footer?.querySelector('button[aria-label="暂停"]') ? 'playing' : (footer?.querySelector('button[aria-label="播放"]') ? 'paused' : 'unknown'),
        footerTitle: footer?.querySelector('.truncate')?.textContent?.trim() ?? null,
        times: Array.from(footer?.querySelectorAll('.tabular-nums') ?? []).map(e => e.textContent.trim()),
        audioLog: window.__audioLog,
      }
    })()`)

    const net = requests.filter((u) => /bilivideo|hdslb|127\.0\.0\.1|imusic-cache|audio|playurl|pagelist/i.test(u)).slice(-25)
    console.log(JSON.stringify({ res, net, failed, console: consoleLines.slice(-40) }, null, 1))
  } catch (e) {
    console.log('ERR', e.message)
  } finally {
    ws.close()
    process.exit(0)
  }
})
