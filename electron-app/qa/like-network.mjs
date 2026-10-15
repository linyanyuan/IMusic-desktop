// 抓取点喜欢时对 /api/library 的 PUT 请求与响应体
const port = process.argv[2] ?? '9233'
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const t = list.find((x) => x.type === 'page' && !x.url.includes('lyrics-window') && !x.url.startsWith('about:blank'))
const ws = new WebSocket(t.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const reqs = new Map()
const done = []
const send = (method, params = {}) => new Promise((res, rej) => { const my = ++id; pending.set(my, { res, rej }); ws.send(JSON.stringify({ id: my, method, params })) })
ws.addEventListener('message', (ev) => {
  let m; try { m = JSON.parse(ev.data) } catch { return }
  if (m.method === 'Network.requestWillBeSent') {
    const r = m.params.request
    if (r.url.includes('/api/library')) reqs.set(m.params.requestId, { method: r.method, url: r.url, body: (r.postData || '').slice(0, 1200) })
  }
  if (m.method === 'Network.responseReceived') {
    const e = reqs.get(m.params.requestId)
    if (e != null) { e.status = m.params.response.status; e.statusText = m.params.response.statusText }
  }
  if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') {
    const e = reqs.get(m.params.requestId)
    if (e != null && !done.includes(e)) { done.push(e); reqs.delete(m.params.requestId) }
  }
  const p = pending.get(m.id); if (p == null) return
  pending.delete(m.id)
  if (m.error != null) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result)
})
await new Promise((r) => ws.addEventListener('open', r))
await send('Network.enable'); await send('Runtime.enable')
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails != null) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const before = await evaluate(`return [...document.querySelectorAll('footer button')].find(b=>/喜欢/.test(b.getAttribute('aria-label')||''))?.getAttribute('aria-label') ?? null`)
await evaluate(`[...document.querySelectorAll('footer button')].find(b=>/喜欢/.test(b.getAttribute('aria-label')||''))?.click(); return true`)
await wait(9000)
const after = await evaluate(`return [...document.querySelectorAll('footer button')].find(b=>/喜欢/.test(b.getAttribute('aria-label')||''))?.getAttribute('aria-label') ?? null`)
console.log(JSON.stringify({ before, after, requests: done.map(d => ({ method: d.method, status: d.status, bodyHead: d.body.slice(0, 400) })) }, null, 1))
ws.close()
