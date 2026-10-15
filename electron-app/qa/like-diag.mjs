const port = process.argv[2] ?? '9233'
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const t = list.find((x) => x.type === 'page' && !x.url.includes('lyrics-window') && !x.url.startsWith('about:blank'))
const ws = new WebSocket(t.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const logs = []
const send = (method, params = {}) => new Promise((res, rej) => { const my = ++id; pending.set(my, { res, rej }); ws.send(JSON.stringify({ id: my, method, params })) })
ws.addEventListener('message', (ev) => {
  let m; try { m = JSON.parse(ev.data) } catch { return }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args ?? []).map((a) => a.value !== undefined ? String(a.value) : (a.preview?.properties?.map(p=>`${p.name}=${p.value}`).join(',') ?? a.description ?? a.type)).join(' ')
    logs.push(`[${m.params.type}] ${text.slice(0, 300)}`)
  }
  if (m.method === 'Log.entryAdded') logs.push(`[log:${m.params.entry.level}] ${(m.params.entry.text||'').slice(0,300)}`)
  const p = pending.get(m.id); if (p == null) return
  pending.delete(m.id)
  if (m.error != null) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result)
})
await new Promise((r) => ws.addEventListener('open', r))
await send('Runtime.enable'); await send('Log.enable')
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails != null) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await evaluate(`window.__likeErrs=[]; window.addEventListener('unhandledrejection', e => window.__likeErrs.push(String(e.reason && e.reason.stack || e.reason).slice(0,400))); return true`)
const before = await evaluate(`return [...document.querySelectorAll('footer button')].find(b=>/喜欢/.test(b.getAttribute('aria-label')||''))?.getAttribute('aria-label') ?? null`)
await evaluate(`[...document.querySelectorAll('footer button')].find(b=>/喜欢/.test(b.getAttribute('aria-label')||''))?.click(); return true`)
await wait(8000)
const after = await evaluate(`return [...document.querySelectorAll('footer button')].find(b=>/喜欢/.test(b.getAttribute('aria-label')||''))?.getAttribute('aria-label') ?? null`)
const errs = await evaluate(`return window.__likeErrs`)
console.log(JSON.stringify({ before, after, unhandled: errs, logs: logs.filter(l=>/like|library|Library|PUT|401|403|500|error/i.test(l)).slice(-12) }, null, 1))
ws.close()
