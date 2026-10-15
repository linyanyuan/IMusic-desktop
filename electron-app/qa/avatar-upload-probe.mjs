// 头像上传端到端探针：DOM.setFileInputFiles 驱动真实文件选择 → 上传 → 验证 /me 变化
const port = process.argv[2] ?? '9228'
const filePath = process.argv[3]
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const t = list.find((x) => x.type === 'page' && !x.url.includes('lyrics-window') && !x.url.startsWith('about:blank'))
const ws = new WebSocket(t.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => { const my = ++id; pending.set(my, { res, rej }); ws.send(JSON.stringify({ id: my, method, params })) })
ws.addEventListener('message', (ev) => {
  let m; try { m = JSON.parse(ev.data) } catch { return }
  const p = pending.get(m.id); if (p == null) return
  pending.delete(m.id)
  if (m.error != null) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result)
})
await new Promise((r) => ws.addEventListener('open', r))
await send('Runtime.enable'); await send('DOM.enable'); await send('Page.enable')
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails != null) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 去设置页
await evaluate(`[...document.querySelectorAll('button')].find(b=>(b.textContent||'').trim()==='设置')?.click(); return true`)
await wait(1200)

// 上传前头像 URL
const before = await evaluate(`
  return { src: document.querySelector('[data-user-avatar] img')?.src ?? null }
`)

// DOM.setFileInputFiles 驱动文件选择
const doc = await send('DOM.getDocument', { depth: 1 })
const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-testid="avatar-file-input"]' })
await send('DOM.setFileInputFiles', { files: [filePath], nodeId: node.nodeId })

// 等上传完成（消息出现「头像已更新」或头像 src 变化）
let result = null
for (let i = 0; i < 30; i++) {
  await wait(500)
  result = await evaluate(`
    const src = document.querySelector('[data-user-avatar] img')?.src ?? null
    const msg = [...document.querySelectorAll('p')].map(p=>p.textContent).find(t=>/头像/.test(t)) ?? null
    return { src, msg }
  `)
  if ((result.src !== before.src && result.src != null) || /头像已更新|失败/.test(result.msg ?? '')) break
}
console.log(JSON.stringify({ before: before.src, after: result }, null, 1))
ws.close()
