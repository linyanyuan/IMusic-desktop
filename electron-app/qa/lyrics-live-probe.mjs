/**
 * 歌词抽屉「真实音源」验收取证 —— 逐个试播 B站候选，直到出现歌词行。
 * 目的：证明 PlayerContext 现在会异步补取歌词（此前渲染层从不调用 MusicService.getLyrics，
 *       B站直链播放时 playUrl.lyrics 为空 → 抽屉永远「暂无歌词」）。
 * 用法: node qa/lyrics-live-probe.mjs [port] [query]
 * 判定：
 *   出现歌词行 = 抽屉拿到非空 LRC（异步补取生效）
 *   同步 = 高亮行 data-lyric-time <= 播放位置 < 下一行时间（容差 1.5s）
 *   设置生效 = 高亮行 font-size / color 与设置页一致
 */
const port = process.argv[2] ?? '9223'
const query = process.argv[3] ?? '周杰伦 晴天 歌词'
const maxCandidates = 6

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
    consoleLines.push(`[${m.params.type}] ${text}`.slice(0, 200))
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
    const report = await evalJs(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const byAria = (sel, label, root = document) =>
        Array.from(root.querySelectorAll(sel)).find((e) => e.getAttribute('aria-label') === label)
      const navText = (label) =>
        Array.from(document.querySelectorAll('aside button')).find((b) => b.textContent.trim() === label)
      const setNative = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      const rowsNow = () => Array.from(document.querySelectorAll('main .group.flex.items-center'))
      const footerPlaying = () => document.querySelector('footer button[aria-label="暂停"]') != null
      const footerTitle = () => document.querySelector('footer .truncate')?.textContent?.trim() ?? null
      const out = { query: ${JSON.stringify(query)} }

      // 1) 读设置页期望值（字号 / 高亮色）
      navText('设置')?.click()
      await sleep(400)
      const slider = byAria('input', '歌词字号')
      out.expect = {
        fontSize: Number(slider?.value ?? 0),
        persistedFontSize: localStorage.getItem('settings_lyrics_font_size'),
        persistedColor: localStorage.getItem('settings_lyrics_color'),
      }

      // 2) 搜索（全部音源）
      navText('搜索')?.click()
      await sleep(400)
      Array.from(document.querySelectorAll('main button'))
        .find((b) => b.textContent.trim() === '全部音源')
        ?.click()
      await sleep(300)
      const input = document.querySelector('main input[placeholder*="搜索"]')
      setNative.call(input, ${JSON.stringify(query)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(200)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      for (let i = 0; i < 40; i++) {
        await sleep(500)
        if (rowsNow().length > 0) break
      }
      out.search = {
        count: rowsNow().length,
        titles: rowsNow().slice(0, ${maxCandidates}).map((r) => r.textContent.trim().slice(0, 40)),
      }

      // 3) 打开歌词抽屉（此后不再开关，切歌即考验抽屉刷新）
      // drawerOpened 用「抽屉行容器存在」判定，而不是 length >= 0（恒真会让报告误导）
      byAria('button', '歌词')?.click()
      await sleep(800)
      out.drawerOpened = document.querySelectorAll('[data-lyric-line]').length > 0
      out.drawerInitialLines = document.querySelectorAll('[data-lyric-line]').length

      // 4) 逐个候选试播，直到歌词行出现
      const readActive = () => {
        const el = document.querySelector('[data-active="true"]')
        if (el == null) return null
        const cs = getComputedStyle(el)
        return {
          index: Number(el.dataset.lyricLine),
          timeMs: Number(el.dataset.lyricTime),
          text: el.textContent.trim().slice(0, 30),
          fontSize: cs.fontSize,
          color: cs.color,
        }
      }
      const pos = () => {
        const t = document.querySelector('footer .tabular-nums')?.textContent?.trim() ?? '0:00'
        const [mm, ss] = t.split(':').map(Number)
        return { text: t, ms: (mm * 60 + ss) * 1000 }
      }
      out.attempts = []
      for (let i = 0; i < ${maxCandidates}; i++) {
        const row = rowsNow()[i]
        if (row == null) {
          out.attempts.push({ i, skip: 'no row' })
          break
        }
        const rowTitle = row.textContent.trim().slice(0, 40)
        const btns = Array.from(row.querySelectorAll('button'))
        const play = btns.find((b) => (b.getAttribute('aria-label') ?? '').startsWith('播放'))
        if (play == null) {
          out.attempts.push({ i, rowTitle, skip: 'no play button', buttons: btns.map((b) => b.getAttribute('aria-label')) })
          continue
        }
        play.click()
        let started = false
        for (let k = 0; k < 24; k++) {
          await sleep(500)
          if (footerPlaying()) {
            started = true
            break
          }
        }
        let lineCount = 0
        for (let k = 0; k < 24; k++) {
          lineCount = document.querySelectorAll('[data-lyric-line]').length
          if (lineCount > 0) break
          await sleep(500)
        }
        out.attempts.push({ i, rowTitle, started, lineCount, footerTitle: footerTitle() })
        if (lineCount > 0 && started) {
          const lines = Array.from(document.querySelectorAll('[data-lyric-line]'))
          const times = lines.map((el) => Number(el.dataset.lyricTime))
          const first = readActive()
          const p1 = pos()
          await sleep(8000)
          const second = readActive()
          const p2 = pos()
          const judge = (a, p) => {
            if (a == null) return null
            const next = times[a.index + 1] ?? Number.POSITIVE_INFINITY
            return { ok: a.timeMs <= p.ms + 1500 && p.ms < next, nextLineMs: next === Infinity ? null : next }
          }
          out.lyrics = {
            lineCount,
            firstLine: lines[0]?.textContent?.trim().slice(0, 30) ?? null,
            first,
            syncAtFirst: { pos: p1, ...judge(first, p1) },
            after8s: second,
            syncAfter8s: { pos: p2, ...judge(second, p2) },
            advanced: first != null && second != null ? second.index > first.index : null,
            activeInViewport: (() => {
              const el = document.querySelector('[data-active="true"]')
              const scroller = el?.closest('.overflow-y-auto')
              if (el == null || scroller == null) return null
              const r = el.getBoundingClientRect()
              const c = scroller.getBoundingClientRect()
              return r.top >= c.top - 30 && r.bottom <= c.bottom + 30
            })(),
          }
          out.settingsAppliedToLyrics = {
            fontSizeMatches: first != null && Number.parseFloat(first.fontSize) === out.expect.fontSize,
            color: first?.color ?? null,
          }
          out.successIndex = i
          return out
        }
      }
      return out
    })()`)

    console.log(JSON.stringify({ report, console: consoleLines.slice(-20) }, null, 1))
  } catch (e) {
    console.log('ERR', e.message)
  } finally {
    ws.close()
    process.exit(0)
  }
})
