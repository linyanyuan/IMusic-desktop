/**
 * 扫描 B站候选视频里哪些带 CC 字幕（歌词异步补取的先决条件）。
 * 用法: node qa/bili-cc-scan.mjs [port]
 * 说明：B站音乐区绝大多数视频是「内嵌歌词」，没有 CC 字幕；带字幕的通常是外语歌翻译/官方 MV。
 */
const port = process.argv[2] ?? '9223'

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('about:blank'))
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
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  })
  if (r.exceptionDetails != null) {
    throw new Error(JSON.stringify(r.exceptionDetails.exception ?? r.exceptionDetails))
  }
  return r.result?.value
}

ws.addEventListener('open', async () => {
  try {
    await send('Runtime.enable')
    const out = await evalJs(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const navText = (label) =>
        Array.from(document.querySelectorAll('aside button')).find((b) => b.textContent.trim() === label)
      const setNative = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      const rowsNow = () => Array.from(document.querySelectorAll('main .group.flex.items-center'))

      // 从行元素的 React fiber 上取回 Song 对象（拿到 bvid）
      const songFrom = (el) => {
        const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$') || x.startsWith('__reactInternalInstance$'))
        let f = k == null ? null : el[k]
        let depth = 0
        while (f != null && depth++ < 60) {
          const p = f.memoizedProps
          if (p != null && typeof p === 'object') {
            for (const v of Object.values(p)) {
              if (v != null && typeof v === 'object' && typeof v.id === 'string' && v.id.startsWith('bilibili:')) return v
            }
          }
          f = f.return
        }
        return null
      }
      const cidOf = async (bvid) => {
        try {
          const r = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid)
          const j = await r.json()
          return j?.data?.cid ?? null
        } catch {
          return null
        }
      }
      const subsOf = async (bvid, cid) => {
        try {
          const r = await fetch(
            'https://api.bilibili.com/x/player/wbi/v2?bvid=' + bvid + '&cid=' + cid + '&web_location=1315875',
          )
          const j = await r.json()
          const list = j?.data?.subtitle?.subtitles ?? []
          return list.map((s) => s.lan_doc || s.lan)
        } catch {
          return []
        }
      }

      navText('搜索')?.click()
      await sleep(400)
      Array.from(document.querySelectorAll('main button'))
        .find((b) => b.textContent.trim() === '全部音源')
        ?.click()
      await sleep(300)
      const input = document.querySelector('main input[placeholder*="搜索"]')

      const queries = ['周杰伦 晴天 歌词', '中文翻译 歌曲', '日语歌 中文字幕', '欧美 中文字幕 歌曲']
      const result = []
      for (const q of queries) {
        setNative.call(input, q)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await sleep(200)
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        for (let i = 0; i < 40; i++) {
          await sleep(400)
          if (rowsNow().length > 0) break
        }
        const rows = rowsNow().slice(0, 12)
        const probe = []
        for (let i = 0; i < rows.length; i++) {
          const song = songFrom(rows[i])
          const bvid = song == null ? '' : song.id.slice('bilibili:'.length)
          if (bvid === '') {
            probe.push({ i, bvid: null, title: rows[i].textContent.trim().slice(0, 34) })
            continue
          }
          const cid = await cidOf(bvid)
          const subs = cid == null ? [] : await subsOf(bvid, cid)
          probe.push({ i, bvid, cid, subs, title: rows[i].textContent.trim().slice(0, 34) })
        }
        result.push({ query: q, rows: rows.length, probe })
      }
      return result
    })()`)

    const flat = []
    for (const block of out) {
      for (const p of block.probe) {
        if (Array.isArray(p.subs) && p.subs.length > 0) flat.push({ query: block.query, ...p })
      }
    }
    console.log(
      JSON.stringify(
        {
          withSubs: flat,
          summary: out.map((b) => ({
            query: b.query,
            rows: b.rows,
            scanned: b.probe.length,
            withSubs: b.probe.filter((p) => Array.isArray(p.subs) && p.subs.length > 0).length,
          })),
        },
        null,
        1,
      ),
    )
  } catch (e) {
    console.log('ERR', e.message)
  } finally {
    ws.close()
    process.exit(0)
  }
})
