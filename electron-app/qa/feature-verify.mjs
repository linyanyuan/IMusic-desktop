// 本轮功能迭代的端到端冒烟验证：通过 CDP 驱动运行中的开发版 Electron。
//
// 用法: 先启动 `npx electron . --remote-debugging-port=9333`，再跑
//       node qa/feature-verify.mjs [port]
// 输出协议：console.log（与 qa/ 下其它探针一致）。
//
// 覆盖：①歌单详情「收藏歌单」按钮存在 ②搜索页分类卡进入分类页（真实分类
// 浏览，非关键词搜索）③首页口味引导卡 / 个性化推荐副标题。

const port = process.argv[2] ?? '9333'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find(
  (t) => t.type === 'page' && !t.url.startsWith('about:blank') && !t.url.includes('lyrics-window'),
)
if (page == null) {
  console.log(JSON.stringify({ error: 'no page target', targets: list.map((t) => t.url) }))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
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
  const p = pending.get(m.id)
  if (p == null) return
  pending.delete(m.id)
  if (m.error != null) p.rej(new Error(JSON.stringify(m.error)))
  else p.res(m.result)
})

await new Promise((r) => ws.addEventListener('open', r))

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails != null) {
    throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400))
  }
  return r.result?.value
}

/** 轮询表达式直到真值或超时，返回最终值 */
async function waitFor(expression, timeoutMs = 15000) {
  const start = Date.now()
  for (;;) {
    const v = await evalJs(expression)
    if (v) return v
    if (Date.now() - start > timeoutMs) return null
    await sleep(400)
  }
}

// 页面内工具：按文字找按钮并点击；返回诊断对象
const HELPER = `(() => {
  window.__v = {
    clickByText(text, tag = 'button') {
      const els = [...document.querySelectorAll(tag)]
      const el = els.find((e) => (e.textContent ?? '').trim().includes(text))
      if (el == null) return null
      el.click()
      return (el.textContent ?? '').trim().slice(0, 30)
    },
    headings() {
      return [...document.querySelectorAll('h1,h2')]
        .map((h) => (h.textContent ?? '').trim())
        .filter(Boolean)
        .slice(0, 8)
    },
  }
  return true
})()`

const report = { steps: [] }
const step = (name, value) => {
  report.steps.push({ name, value })
  console.log(`${name}: ${JSON.stringify(value)}`)
}

try {
  await evalJs(HELPER)

  // ---------- 首页：口味引导卡或个性化副标题 ----------
  await waitFor(`document.querySelector('h1') != null`)
  const home = await evalJs(`(() => ({
    onboarding: document.querySelector('[data-testid="taste-onboarding"]') != null,
    adjustLink: document.querySelector('[data-testid="taste-adjust-link"]') != null,
    headings: window.__v.headings(),
    tasteStore: localStorage.getItem('imusic:tastePreferences'),
  }))()`)
  step('home', home)

  // ---------- 搜索页：分类卡 → 分类页 ----------
  await evalJs(`document.querySelector('[data-testid=\"nav-search\"]')?.click() ?? window.__v.clickByText('搜索')`)
  await sleep(800)
  await evalJs(HELPER)
  const searchState = await evalJs(`(() => ({
    headings: window.__v.headings(),
    categoryCards: [...document.querySelectorAll('button')].filter((b) => b.style.background.includes('gradient')).map((b) => (b.textContent ?? '').trim()),
  }))()`)
  step('search.categories', searchState)

  await evalJs(`window.__v.clickByText('流行')`)
  // 分类页应出现「热门歌单 / 热门单曲」两个 Tab，而不是「单曲 / 歌单」搜索结果 Tab
  const categoryReady = await waitFor(
    `[...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('热门歌单'))`,
  )
  step('category.tabsShown', categoryReady)
  const categorySongs = await waitFor(
    `(() => { const rows = document.querySelectorAll('[data-testid="song-table"], table, [class*="grid"]'); return [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('换一批')) })()`,
    20000,
  )
  const categoryState = await evalJs(`(() => ({
    headings: window.__v.headings(),
    songText: (document.body.textContent ?? '').includes('热门单曲'),
    playlistCards: document.querySelectorAll('[data-testid^="category-playlist"], [class*="grid"] button').length,
    swapLoaded: ${categorySongs ? 'true' : 'false'},
  }))()`)
  step('category.state', categoryState)

  // 进入一个分类歌单 → 详情页应有「收藏歌单」按钮
  const opened = await evalJs(`(() => {
    const grids = [...document.querySelectorAll('[class*="grid"]')]
    for (const g of grids) {
      const btns = [...g.querySelectorAll('button')].filter((b) => b.querySelector('img,[class*="Cover"],div'))
      if (btns.length > 0) { btns[0].click(); return (btns[0].textContent ?? '').trim().slice(0, 40) }
    }
    return null
  })()`)
  step('category.openPlaylist', opened)
  const collectBtn = await waitFor(`document.querySelector('[data-testid="playlist-collect"]') != null`, 20000)
  const detailState = await evalJs(`(() => ({
    collectBtn: document.querySelector('[data-testid="playlist-collect"]')?.textContent?.trim() ?? null,
    collected: document.querySelector('[data-testid="playlist-collect"]')?.dataset?.collected ?? null,
    headings: window.__v.headings(),
    songRows: document.querySelectorAll('tbody tr, [data-testid="song-table"] tr').length,
  }))()`)
  step('detail.collect', { collectBtn, ...detailState })

  // ---------- 首页推荐：保存口味 → 副标题应变个性化 ----------
  await evalJs(`(() => {
    const store = { genres: ['pop', 'rock'], skipped: false, updatedAt: new Date().toISOString() }
    localStorage.setItem('imusic:tastePreferences', JSON.stringify(store))
    // 通知 store 订阅者（TastePreferencesStore 用自定义事件/监听）
    window.dispatchEvent(new Event('imusic:tastePreferences'))
    return true
  })()`)
  await evalJs(`document.querySelector('[data-testid=\"nav-home\"]')?.click() ?? window.__v.clickByText('首页')`)
  await sleep(500)
  await evalJs(HELPER)
  const personalized = await waitFor(
    `(document.body.textContent ?? '').includes('根据 流行')`,
    25000,
  )
  step('home.personalizedSubtitle', personalized)

  report.ok = true
} catch (e) {
  report.ok = false
  report.error = String(e?.message ?? e)
  console.log(`ERROR: ${report.error}`)
}

ws.close()
console.log(JSON.stringify({ ok: report.ok, steps: report.steps.length }))
process.exit(report.ok ? 0 : 1)
