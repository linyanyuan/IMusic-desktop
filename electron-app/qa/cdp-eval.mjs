/**
 * 通用 CDP 取值工具：对运行中的 Electron 窗口求值一个 JS 表达式并打印 JSON。
 *
 * 用法: node qa/cdp-eval.mjs "<js 表达式>" [port]
 *   port 形如 http://127.0.0.1:9222（默认 9222）
 *
 * 之所以不用 agent_browser：Electron 不支持 CDP Target.createTarget，
 * 浏览器工具会落在 about:blank 上（见项目记忆）。
 */
const expression = process.argv[2]
const port = process.argv[3] ?? '9222'
if (expression == null) {
  console.error('用法: node qa/cdp-eval.mjs "<js 表达式>" [port]')
  process.exit(64)
}

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find(
  (t) =>
    t.type === 'page' && !t.url.startsWith('about:blank') && !t.url.includes('lyrics-window'),
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

ws.addEventListener('open', async () => {
  try {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    console.log(JSON.stringify(r.result?.value ?? r.result ?? null, null, 2))
    ws.close()
    process.exit(0)
  } catch (e) {
    console.log(JSON.stringify({ error: String(e?.message ?? e) }))
    process.exit(1)
  }
})
