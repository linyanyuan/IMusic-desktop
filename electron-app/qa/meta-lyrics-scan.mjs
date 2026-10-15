/**
 * 元数据（GDStudio）音源诊断：各源 url 是否可用 + 歌词接口是否返回 LRC。
 * 用法: node qa/meta-lyrics-scan.mjs [port] [query]
 * 背景：GDStudio 上游 joox 已失效（types=url&source=joox 返回空 url），
 *      搜索结果第一页固定取「第一个有结果的源」(joox)，因此元数据歌曲直链播放失败，
 *      会回退 B站按标题搜索。此脚本量化每个源的真实可用性。
 */
const port = process.argv[2] ?? '9223'
const query = process.argv[3] ?? '起风了'

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
      // 从 React fiber 的 hooks 里取搜索结果数组（SearchView 的 state）
      const resultsFromFiber = () => {
        const rows = rowsNow()
        const el = rows[0]
        const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$'))
        let f = k == null ? null : el[k]
        let d = 0
        while (f != null && d++ < 40) {
          let hook = f.memoizedState
          let hi = 0
          while (hook != null && hi++ < 40) {
            const v = hook.memoizedState
            const arr = Array.isArray(v) ? v : null
            if (
              arr != null &&
              arr.length === rows.length &&
              arr[0] != null &&
              typeof arr[0] === 'object' &&
              typeof arr[0].id === 'string'
            ) {
              return arr
            }
            hook = hook.next
          }
          f = f.return
        }
        return []
      }
      const getText = async (url) => {
        try {
          const r = await fetch(url)
          const text = await r.text()
          return { status: r.status, text }
        } catch (e) {
          return { status: 0, text: 'ERR ' + String(e) }
        }
      }

      navText('搜索')?.click()
      await sleep(400)
      Array.from(document.querySelectorAll('main button'))
        .find((b) => b.textContent.trim() === '元数据歌曲')
        ?.click()
      await sleep(300)
      const input = document.querySelector('main input[placeholder*="搜索"]')
      setNative.call(input, ${JSON.stringify(query)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(200)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      for (let i = 0; i < 40; i++) {
        await sleep(400)
        if (rowsNow().length > 0) break
      }
      const rows = rowsNow().slice(0, 6)
      const songsAll = resultsFromFiber()
      const songs = rows.map((r, i) => {
        const s = songsAll[i] ?? null
        return {
          i,
          rowTitle: r.textContent.trim().slice(0, 26),
          id: s?.id ?? null,
          artist: s?.artist ?? null,
          lyricId: s?.lyric_id ?? null,
        }
      })

      const buildUrl = (types, source, mediaId, br) => {
        let u = 'https://music-api.gdstudio.xyz/api.php?types=' + types
        u += '&source=' + source + '&id=' + encodeURIComponent(mediaId)
        if (br != null) u += '&br=' + String(br)
        return u
      }
      const sources = ['joox', 'netease', 'kuwo', 'tencent', 'kugou', 'migu']
      const firstGd = songs.find((s) => (s.id ?? '').startsWith('gdstudio:'))
      const mediaId = firstGd == null ? '' : firstGd.id.split(':').slice(2).join(':')
      const urlBySource = []
      if (mediaId !== '') {
        for (const source of sources) {
          const res = await getText(buildUrl('url', source, mediaId, 192))
          urlBySource.push({ source, status: res.status, body: res.text.slice(0, 120) })
        }
      }

      // 2) 歌词接口
      const lyricBySource = []
      if (firstGd != null) {
        const parts = firstGd.id.split(':')
        const idPart = parts.slice(2).join(':')
        for (const source of ['joox', 'netease', 'kuwo']) {
          const res = await getText(buildUrl('lyric', source, idPart, null))
          let hasLrc = false
          let sample = ''
          try {
            const j = JSON.parse(res.text)
            const ly = String(j?.lyric ?? '')
            hasLrc = ly.trim().length > 0
            sample = ly.slice(0, 60).replace(/\\n/g, ' | ')
          } catch {
            sample = res.text.slice(0, 60)
          }
          lyricBySource.push({ source, status: res.status, hasLrc, sample })
        }
      }

      return {
        query: ${JSON.stringify(query)},
        resultCount: rowsNow().length,
        songs,
        mediaId: mediaId.slice(0, 24),
        urlBySource,
        lyricBySource,
      }
    })()`)

    console.log(JSON.stringify(out, null, 1))
  } catch (e) {
    console.log('ERR', e.message)
  } finally {
    ws.close()
    process.exit(0)
  }
})
