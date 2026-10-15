// 歌单删除探针：建一个测试歌单 → sidebar 悬停垃圾桶 → confirm → 删除 → 验证消失
const port = process.argv[2] ?? '9228'
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = list.find((t) => t.type === 'page' && !t.url.startsWith('about:blank') && !t.url.includes('lyrics-window'))
if (target == null) { console.log(JSON.stringify({ error: 'no page' })); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const dialogs = []
const send = (method, params = {}) => new Promise((res, rej) => {
  const my = ++id; pending.set(my, { res, rej })
  ws.send(JSON.stringify({ id: my, method, params }))
})
ws.addEventListener('message', (ev) => {
  let m; try { m = JSON.parse(ev.data) } catch { return }
  if (m.method === 'Page.javascriptDialogOpening') {
    dialogs.push(m.params.message)
    send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
    return
  }
  const p = pending.get(m.id); if (p == null) return
  pending.delete(m.id)
  if (m.error != null) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result)
})
await new Promise((res) => ws.addEventListener('open', res))
await send('Runtime.enable')
await send('Page.enable')
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails != null) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
  return r.result.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const NAME = 'QA删除测试'

// 1) 创建歌单
await evaluate(`
  const btn=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='新建歌单')
  if(!btn) throw new Error('no create button')
  btn.click(); await new Promise(r=>setTimeout(r,600))
  const input=[...document.querySelectorAll('input')].find(i=>/歌单名|名称|名字/.test(i.placeholder||'')) ?? document.querySelector('input[type="text"]:not([placeholder*="搜索"])')
  if(!input) throw new Error('no name input: '+[...document.querySelectorAll('input')].map(i=>i.placeholder))
  const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set
  setter.call(input,'${NAME}'); input.dispatchEvent(new Event('input',{bubbles:true}))
  await new Promise(r=>setTimeout(r,300))
  const ok=[...document.querySelectorAll('button')].find(b=>['创建','确定','保存'].includes((b.textContent||'').trim()))
  if(!ok) throw new Error('no submit: '+[...document.querySelectorAll('button')].map(b=>b.textContent.trim()))
  ok.click(); await new Promise(r=>setTimeout(r,1200))
  return true
`)
const created = await evaluate(`
  return [...document.querySelectorAll('button[aria-label^="删除歌单"]')].map(b=>b.getAttribute('aria-label'))
`)
// 2) 删除（强制显示垃圾桶按钮再点）
const deleted = await evaluate(`
  const delBtn=[...document.querySelectorAll('button[aria-label^="删除歌单"]')].find(b=>b.getAttribute('aria-label').includes('${NAME}'))
  if(!delBtn) return { error:'no delete button', labels: [...document.querySelectorAll('button[aria-label^="删除歌单"]')].map(b=>b.getAttribute('aria-label')) }
  delBtn.classList.remove('hidden')
  delBtn.click()
  await new Promise(r=>setTimeout(r,1500))
  return { gone: [...document.querySelectorAll('button[aria-label^="删除歌单"]')].find(b=>b.getAttribute('aria-label').includes('${NAME}')) == null }
`)
console.log(JSON.stringify({ created, deleted, dialogMessages: dialogs }, null, 1))
ws.close()
