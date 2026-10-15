// 独立歌词窗口探针：连到 #/lyrics-window 目标，验证状态转发 + 控制回发
const port = process.argv[2] ?? '9228'

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('lyrics-window'))
if (target == null) { console.log(JSON.stringify({ error: 'no lyrics-window target' })); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => {
  const my = ++id
  pending.set(my, { res, rej })
  ws.send(JSON.stringify({ id: my, method, params }))
})
ws.addEventListener('message', (ev) => {
  let m
  try { m = JSON.parse(ev.data) } catch { return }
  const p = pending.get(m.id)
  if (p == null) return
  pending.delete(m.id)
  if (m.error != null) p.rej(new Error(JSON.stringify(m.error)))
  else p.res(m.result)
})
await new Promise((res) => ws.addEventListener('open', res))
await send('Runtime.enable')

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 等状态到达（主窗口正在放歌，桥每 500ms 推一帧）
let snapshot = null
for (let i = 0; i < 20; i++) {
  snapshot = await evaluate(`
    const current = document.querySelector('[data-lyric-current]')?.textContent ?? null
    const next = document.querySelector('[data-lyric-next]')?.textContent ?? null
    const playBtn = document.querySelector('button[aria-label="暂停"], button[aria-label="播放"]')
    return { current, next, playLabel: playBtn?.getAttribute('aria-label') ?? null, pill: document.querySelector('.lyrics-pill') != null }
  `)
  if (snapshot.current != null && snapshot.current !== '') break
  await wait(500)
}

// 控制回发：在歌词窗口点暂停 → 主窗口应该停（按钮变播放）
await evaluate(`document.querySelector('button[aria-label="暂停"]')?.click(); return true`)
await wait(1500)
const afterPause = await evaluate(`
  return { playLabel: document.querySelector('button[aria-label="暂停"], button[aria-label="播放"]')?.getAttribute('aria-label') ?? null }
`)
await evaluate(`document.querySelector('button[aria-label="播放"]')?.click(); return true`)
await wait(1500)
const afterResume = await evaluate(`
  return { playLabel: document.querySelector('button[aria-label="暂停"], button[aria-label="播放"]')?.getAttribute('aria-label') ?? null }
`)

const report = {
  snapshot,
  pauseWorks: afterPause.playLabel === '播放',
  resumeWorks: afterResume.playLabel === '暂停',
  verdict: snapshot.current != null && snapshot.current !== '' && afterPause.playLabel === '播放' && afterResume.playLabel === '暂停' ? 'pass' : 'fail',
}
console.log(JSON.stringify(report, null, 2))
ws.close()
process.exit(report.verdict === 'pass' ? 0 : 1)
