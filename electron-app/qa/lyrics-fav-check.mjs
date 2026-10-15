// 在歌词窗点「喜欢」，然后在主窗口验证收藏态是否回传
const port = process.argv[2] ?? '9228'
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const lyr = list.find((t) => t.type === 'page' && t.url.includes('lyrics-window'))
const mainT = list.find((t) => t.type === 'page' && !t.url.includes('lyrics-window') && !t.url.startsWith('about:blank'))
if (lyr == null || mainT == null) {
  console.log(
    JSON.stringify({
      error: 'missing target',
      lyricsWindow: lyr == null ? 'not found' : lyr.url,
      mainWindow: mainT == null ? 'not found' : mainT.url,
      hint: '先打开独立桌面歌词窗口（Ctrl+Alt+D 或播控栏按钮）再跑本探针',
    }),
  )
  process.exit(1)
}
const connect = async (t) => {
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data) } catch { return }
    const p = pending.get(m.id); if (p == null) return
    pending.delete(m.id)
    if (m.error != null) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result)
  })
  await new Promise((r) => ws.addEventListener('open', r))
  const send = (method, params = {}) => new Promise((res, rej) => { const my = ++id; pending.set(my, { res, rej }); ws.send(JSON.stringify({ id: my, method, params })) })
  await send('Runtime.enable')
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails != null) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
    return r.result.value
  }
  return { evaluate, close: () => ws.close() }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const lyrC = await connect(lyr)
const mainC = await connect(mainT)

const mainLike = () => mainC.evaluate(`return [...document.querySelectorAll('footer button')].find(b=>/喜欢/.test(b.getAttribute('aria-label')||''))?.getAttribute('aria-label') ?? null`)
const lyrLike = () => lyrC.evaluate(`return [...document.querySelectorAll('button')].find(b=>/喜欢/.test(b.getAttribute('aria-label')||''))?.getAttribute('aria-label') ?? null`)

const before = { main: await mainLike(), lyrics: await lyrLike() }
await lyrC.evaluate(`[...document.querySelectorAll('button')].find(b=>/喜欢/.test(b.getAttribute('aria-label')||''))?.click(); return true`)
let after = before
for (let i = 0; i < 12; i++) { await wait(500); after = { main: await mainLike(), lyrics: await lyrLike() }; if (after.main !== before.main || after.lyrics !== before.lyrics) break }
console.log(JSON.stringify({ before, after, mainChanged: after.main !== before.main, lyricsChanged: after.lyrics !== before.lyrics }, null, 1))
lyrC.close(); mainC.close()
