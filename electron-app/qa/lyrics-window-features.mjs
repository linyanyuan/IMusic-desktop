// 歌词窗新功能探针：工具条按钮（喜欢/锁定/上一首/播放/下一首/关闭）、字号颜色同步
const port = process.argv[2] ?? '9228'
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('lyrics-window'))
if (target == null) { console.log(JSON.stringify({ error: 'no lyrics-window target' })); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => {
  const my = ++id; pending.set(my, { res, rej })
  ws.send(JSON.stringify({ id: my, method, params }))
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const features = await evaluate(`
  const labels = [...document.querySelectorAll('button')].map(b=>b.getAttribute('aria-label'))
  const current = document.querySelector('[data-lyric-current]')
  const cs = current ? getComputedStyle(current) : null
  const root = document.querySelector('.lyrics-window-root')
  return {
    buttons: labels,
    fontSize: cs?.fontSize, color: cs?.color, weight: cs?.fontWeight,
    hasTextShadow: (cs?.textShadow||'') !== 'none',
    rootDrag: root ? getComputedStyle(root).webkitAppRegion : null,
  }
`)
// 锁定切换 → 根元素 app-region 应变 no-drag
await evaluate(`document.querySelector('[data-testid="lyrics-lock"]')?.click(); return true`)
await wait(400)
const afterLock = await evaluate(`
  const root = document.querySelector('.lyrics-window-root')
  return { drag: root ? getComputedStyle(root).webkitAppRegion : null, pressed: document.querySelector('[data-testid="lyrics-lock"]')?.getAttribute('aria-pressed') }
`)
await evaluate(`document.querySelector('[data-testid="lyrics-lock"]')?.click(); return true`)
await wait(400)
const afterUnlock = await evaluate(`
  return { drag: getComputedStyle(document.querySelector('.lyrics-window-root')).webkitAppRegion }
`)
// 喜欢按钮 → 主窗口应收藏当前曲（检查按钮变色回传）
const favBefore = await evaluate(`return document.querySelector('button[aria-label="喜欢"], button[aria-label="取消喜欢"]')?.getAttribute('aria-label') ?? null`)
await evaluate(`document.querySelector('button[aria-label="喜欢"], button[aria-label="取消喜欢"]')?.click(); return true`)
let favAfter = null
for (let i=0;i<10;i++){ await wait(500); favAfter = await evaluate(`return document.querySelector('button[aria-label="喜欢"], button[aria-label="取消喜欢"]')?.getAttribute('aria-label') ?? null`); if (favAfter !== favBefore) break }
// 还原
if (favAfter !== favBefore) { await evaluate(`document.querySelector('button[aria-label="喜欢"], button[aria-label="取消喜欢"]')?.click(); return true`); await wait(800) }

console.log(JSON.stringify({ features, afterLock, afterUnlock, favoriteToggle: { before: favBefore, after: favAfter, works: favAfter !== favBefore } }, null, 1))
ws.close()
