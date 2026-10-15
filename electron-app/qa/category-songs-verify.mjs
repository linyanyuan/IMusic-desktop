// 分类页「热门单曲」Tab 与换一批的端到端验证（CDP 驱动运行中的开发版）。
// 用法: node qa/category-songs-verify.mjs [port]
// 输出协议：console.log。
const port = process.argv[2] ?? '9334'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find(
  (t) => t.type === 'page' && !t.url.startsWith('about:blank') && !t.url.includes('lyrics-window'),
)
if (page == null) {
  console.log(JSON.stringify({ error: 'no page target' }))
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
  if (r.exceptionDetails != null) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result?.value
}
async function waitFor(expression, timeoutMs = 20000) {
  const start = Date.now()
  for (;;) {
    const v = await evalJs(expression)
    if (v) return v
    if (Date.now() - start > timeoutMs) return null
    await sleep(400)
  }
}

// 搜索 → 流行 → 热门单曲 Tab
const navOk = await waitFor(`document.querySelector('[data-testid="nav-search"]') != null`)
let popOk = null
for (let attempt = 0; attempt < 3 && popOk == null; attempt++) {
  await evalJs(`document.querySelector('[data-testid="nav-search"]')?.click()`)
  popOk = await waitFor(`[...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '流行')`, 8000)
  if (popOk == null) {
    console.log(`nav.retry: ${JSON.stringify({ attempt, h1: await evalJs(`document.querySelector('h1')?.textContent ?? null`) })}`)
    await evalJs(`document.querySelector('[data-testid="nav-home"]')?.click()`)
    await sleep(800)
  }
}
await evalJs(`[...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '流行')?.click()`)
const tabOk = await waitFor(`[...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('热门单曲'))`)
await evalJs(`[...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('热门单曲'))?.click()`)
console.log(`nav: ${JSON.stringify({ navOk, popOk, tabOk })}`)

// 等单曲行出现（歌名列表）
const rowsAppeared = await waitFor(
  `(() => { const t = document.body.textContent ?? ''; return t.includes('首歌曲') || t.includes('暂无热门单曲') })()`,
  25000,
)
const first = await evalJs(`(() => {
  const main = document.querySelector('main') ?? document.body
  const countText = [...main.querySelectorAll('div')].map((d) => d.textContent ?? '').find((t) => t.includes('首歌曲')) ?? null
  const count = countText?.match(/(\d+)/)?.[1] ?? null
  // SongTable 行：主区域里 aria-hidden 外的 truncate 标题，排除侧栏（aside）
  const titles = [...main.querySelectorAll('.truncate')]
    .filter((e) => e.closest('aside') == null)
    .map((e) => (e.textContent ?? '').trim())
    .filter((s) => s.length > 0)
    .slice(0, 5)
  return { swap: count != null, count, titles }
})()`)
console.log(`songs.shown: ${JSON.stringify({ rowsAppeared, ...first })}`)

if (first?.swap === true) {
  await evalJs(`[...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('换一批'))?.click()`)
  await sleep(2500)
  await waitFor(`(() => { const t = document.body.textContent ?? ''; return /\d+ 首歌曲/.test(t) && !t.includes('正在加载单曲') })()`, 15000)
  const after = await evalJs(`(() => {
    const main = document.querySelector('main') ?? document.body
    return [...main.querySelectorAll('.truncate')]
      .filter((e) => e.closest('aside') == null)
      .map((e) => (e.textContent ?? '').trim())
      .filter((s) => s.length > 0)
      .slice(0, 5)
  })()`)
  const changed = JSON.stringify(after) !== JSON.stringify(first.titles)
  console.log(`songs.swapped: ${JSON.stringify({ changed, after })}`)
}
ws.close()
process.exit(0)
