const port = process.argv[2] ?? '9228'
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('lyrics-window'))
if (target == null) { console.log(JSON.stringify({ error: 'no lyrics-window target' })); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => {
  const my = ++id; pending.set(my, { res, rej }); ws.send(JSON.stringify({ id: my, method, params }))
})
ws.addEventListener('message', (ev) => {
  let m; try { m = JSON.parse(ev.data) } catch { return }
  const p = pending.get(m.id); if (p == null) return
  pending.delete(m.id)
  if (m.error != null) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result)
})
await new Promise((res) => ws.addEventListener('open', res))
await send('Runtime.enable')
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails != null) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result.value
}
const out = await evaluate(`
  const fav = [...document.querySelectorAll('button')].find(b=>/喜欢/.test(b.getAttribute('aria-label')||''))
  const cur = document.querySelector('[data-lyric-current]')
  const cs = cur ? getComputedStyle(cur) : null
  return {
    favExists: fav != null,
    favDisabled: fav?.disabled ?? null,
    favLabel: fav?.getAttribute('aria-label') ?? null,
    currentText: cur?.textContent ?? null,
    color: cs?.color ?? null,
    nextText: document.querySelector('[data-lyric-next]')?.textContent ?? null,
  }
`)
console.log(JSON.stringify(out, null, 1))
ws.close()
