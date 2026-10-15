// 元数据（GDStudio）音源修复取证：源从 joox 切到 netease 后，元数据歌曲应能真播 + 有歌词。
//
// 背景：2026-10 上游回归 —— joox 的 types=url 恒返回空地址，kuwo/tencent/kugou/migu/spotify/deezer
//       一律 HTTP 400 `Value of source is not supported`，只有 netease 的 search/url/lyric 可用。
//       修复前：元数据搜索结果全是 gdstudio:joox:* → 取链为空 → 靠 B站兜底（且 B站无字幕 → 抽屉「暂无歌词」）。
//       修复后：gdstudio:netease:* → types=url 直出 m801.music.126.net → types=lyric 出 LRC。
//
// 判定：
//   playing      = footer 出现「暂停」按钮
//   directUrl    = audio.src 落在 music.126.net（netease 直链，而非 bilivideo 兜底）
//   lyricLines>0 = 抽屉拿到非空 LRC（netease lyric 生效）
//   sync         = 高亮行 data-lyric-time <= 播放位置 < 下一行时间
//
// 用法: node qa/net-source-probe.mjs [port] [query]
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
const consoleLines = []
const requests = []
const failedRequests = []

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
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args ?? [])
      .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? a.type)))
      .join(' ')
    consoleLines.push(`[${m.params.type}] ${text}`.slice(0, 300))
  }
  if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url)
  if (m.method === 'Network.loadingFailed') {
    failedRequests.push({ error: m.params.errorText, type: m.params.type })
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

const INJECT = `
(() => {
  window.__audioLog = []
  const Real = window.Audio
  const wrap = (el, tag) => {
    const rec = { tag, src: el.src, events: [], error: null, readyState: null, networkState: null, currentTime: null, duration: null }
    window.__audioLog.push(rec)
    const sync = () => {
      rec.src = el.src; rec.readyState = el.readyState; rec.networkState = el.networkState
      rec.currentTime = Math.round(el.currentTime * 10) / 10
      rec.duration = Number.isFinite(el.duration) ? Math.round(el.duration * 10) / 10 : null
      if (el.error) rec.error = { code: el.error.code, message: el.error.message }
    }
    for (const evt of ['loadstart','loadedmetadata','loadeddata','canplay','playing','waiting','stalled','suspend','abort','emptied','error','ended','pause','play']) {
      el.addEventListener(evt, () => { sync(); rec.events.push(evt + '@' + Math.round(performance.now())) })
    }
    const origPlay = el.play.bind(el)
    el.play = () => { const p = origPlay(); if (p && p.catch) p.catch(e => { rec.events.push('play-rejected:' + (e && e.message)); sync() }); return p }
    sync()
    return el
  }
  window.Audio = function (...args) { return wrap(new Real(...args), 'new Audio') }
  window.Audio.prototype = Real.prototype
  const origCreate = document.createElement.bind(document)
  document.createElement = function (tag, ...rest) {
    const el = origCreate(tag, ...rest)
    if (String(tag).toLowerCase() === 'audio') wrap(el, 'createElement')
    return el
  }
})()
`

ws.addEventListener('open', async () => {
  try {
    await send('Runtime.enable')
    await send('Page.enable')
    await send('Network.enable')
    await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT })
    await send('Page.reload', { ignoreCache: true })
    await new Promise((r) => setTimeout(r, 3500))

    const report = await evalJs(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const navText = (label) =>
        Array.from(document.querySelectorAll('aside button')).find((b) => b.textContent.trim() === label)
      const byAria = (sel, label, root = document) =>
        Array.from(root.querySelectorAll(sel)).find((e) => e.getAttribute('aria-label') === label)
      const setNative = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      const rowsNow = () => Array.from(document.querySelectorAll('main .group.flex.items-center'))
      const footerPlaying = () => document.querySelector('footer button[aria-label="暂停"]') != null
      const footerTitle = () => document.querySelector('footer .truncate')?.textContent?.trim() ?? null
      const out = { query: ${JSON.stringify(query)} }

      // 1) 搜索 tab + 元数据歌曲 scope
      navText('搜索')?.click(); await sleep(500)
      const scopeBtn = Array.from(document.querySelectorAll('main button'))
        .find((b) => b.textContent.trim() === '元数据歌曲')
      out.scopeClicked = scopeBtn != null
      scopeBtn?.click(); await sleep(300)

      const input = document.querySelector('main input[placeholder*="搜索"]')
      if (input == null) return { ...out, error: 'no search input' }
      setNative.call(input, ${JSON.stringify(query)})
      input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(200)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      for (let i = 0; i < 60; i++) { await sleep(500); if (rowsNow().length > 0) break }

      const rows = rowsNow()
      out.search = {
        count: rows.length,
        titles: rows.slice(0, 5).map((r) => r.textContent.trim().slice(0, 40)),
      }
      if (rows.length === 0) return out

      // 2) 播放第 1 条
      const play = Array.from(rows[0].querySelectorAll('button'))
        .find((b) => (b.getAttribute('aria-label') ?? '').startsWith('播放'))
      out.firstRowHasPlay = play != null
      play?.click()
      for (let i = 0; i < 60; i++) { await sleep(500); if (footerPlaying()) break }
      out.playing = footerPlaying()
      out.footerTitle = footerTitle()
      const audio = (window.__audioLog ?? []).at(-1) ?? null
      out.audio = audio == null ? null : {
        srcHost: (() => { try { return new URL(audio.src).host } catch { return audio.src.slice(0, 60) } })(),
        readyState: audio.readyState,
        networkState: audio.networkState,
        duration: audio.duration,
        currentTime: audio.currentTime,
        error: audio.error,
        events: audio.events,
      }
      out.directNetease = (out.audio?.srcHost ?? '').includes('126.net')

      // 3) 歌词抽屉
      byAria('button', '歌词')?.click(); await sleep(600)
      for (let i = 0; i < 40; i++) {
        if (document.querySelectorAll('[data-lyric-line]').length > 0) break
        await sleep(500)
      }
      const lines = Array.from(document.querySelectorAll('[data-lyric-line]'))
      // data-lyric-time 是「秒」（LyricLine.time 的单位），判定统一换算成毫秒
      const timesMs = lines.map((el) => Number(el.dataset.lyricTime) * 1000)
      const readActive = () => {
        const el = document.querySelector('[data-active="true"]')
        if (el == null) return null
        return { index: Number(el.dataset.lyricLine), timeSec: Number(el.dataset.lyricTime), text: el.textContent.trim().slice(0, 34) }
      }
      const posMs = () => {
        const t = document.querySelector('footer .tabular-nums')?.textContent?.trim() ?? '0:00'
        const [mm, ss] = t.split(':').map(Number)
        return (mm * 60 + ss) * 1000
      }
      const judge = (a, p) => {
        if (a == null) return null
        const lineMs = a.timeSec * 1000
        const next = timesMs[a.index + 1] ?? Number.POSITIVE_INFINITY
        return {
          ok: lineMs <= p + 1500 && p < next,
          lineMs,
          nextLineMs: next === Number.POSITIVE_INFINITY ? null : next,
        }
      }
      const first = readActive()
      const p1 = posMs()
      out.lyrics = {
        lineCount: lines.length,
        firstLine: lines[0]?.textContent?.trim().slice(0, 34) ?? null,
        firstTimesSec: timesMs.slice(0, 6).map((t) => t / 1000),
        first,
        syncAtFirst: judge(first, p1),
        posAtFirstMs: p1,
      }
      await sleep(9000)
      const second = readActive()
      const p2 = posMs()
      out.lyrics.after9s = second
      out.lyrics.posAfter9sMs = p2
      out.lyrics.syncAfter9s = judge(second, p2)
      out.lyrics.advanced = first != null && second != null ? second.index > first.index : null
      out.verdict = {
        playing: out.playing === true,
        neteaseDirect: out.directNetease === true,
        audioHealthy: (out.audio?.error ?? null) === null && (out.audio?.readyState ?? 0) >= 3,
        lyricsLoaded: out.lyrics.lineCount > 0,
        lyricsSynced: out.lyrics.syncAtFirst?.ok === true && out.lyrics.syncAfter9s?.ok === true,
        lyricsAdvanced: out.lyrics.advanced === true,
      }
      out.verdict.pass = Object.values(out.verdict).every((v) => v === true)
      return out
    })()`)

    const netRequests = requests
      .filter((u) => u.includes('music-api.gdstudio.xyz') || u.includes('126.net') || u.includes('bilivideo'))
      .map((u) => {
        const kind = u.includes('types=search') ? 'gdstudio:search'
          : u.includes('types=url') ? 'gdstudio:url'
            : u.includes('types=lyric') ? 'gdstudio:lyric'
              : u.includes('126.net') ? 'netease-cdn'
                : 'bilibili-cdn'
        const src = /[?&]source=([^&]+)/.exec(u)?.[1] ?? null
        return { kind, source: src, host: (() => { try { return new URL(u).host } catch { return null } })() }
      })

    console.log(JSON.stringify({
      report,
      network: netRequests.slice(-25),
      failedRequests: failedRequests.slice(-5),
      console: consoleLines.slice(-14),
    }, null, 1))
  } catch (e) {
    console.log('ERR', e.message)
  } finally {
    ws.close()
    process.exit(0)
  }
})
