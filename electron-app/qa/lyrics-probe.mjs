/**
 * 歌词抽屉验收取证 —— 元数据音源（带 LRC）→ 播放 → 歌词抽屉卡拉OK同步 + 设置项即时生效。
 * 用法: node qa/lyrics-probe.mjs [port]
 * 判定：
 *   同步 = 高亮行 data-lyric-time <= 播放位置 < 下一行时间（容差 1.5s）
 *   设置生效 = 高亮行 font-size == 设置页字号，color == 设置页选中的高亮色
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
      const out = {}

      // 先读设置页当前的字号/高亮色（作为歌词抽屉的期望值）
      navText('设置')?.click()
      await sleep(400)
      const slider = byAria('input', '歌词字号')
      out.expect = {
        fontSize: Number(slider?.value ?? 0),
        color: (() => {
          const sel = Array.from(document.querySelectorAll('main button[aria-label^="歌词高亮色"]')).find(
            (b) => b.className.includes('ring-2'),
          )
          return sel == null ? null : { label: sel.getAttribute('aria-label'), bg: getComputedStyle(sel).backgroundColor }
        })(),
        persisted: {
          fontSize: localStorage.getItem('settings_lyrics_font_size'),
          color: localStorage.getItem('settings_lyrics_color'),
        },
      }

      // 搜索「元数据歌曲」范围（GDStudio/Meting 带 LRC）
      navText('搜索')?.click()
      await sleep(400)
      const tab = Array.from(document.querySelectorAll('main button')).find(
        (b) => b.textContent.trim() === '元数据歌曲',
      )
      tab?.click()
      await sleep(300)
      const input = document.querySelector('main input[placeholder*="搜索"]')
      setNative.call(input, '告白气球')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(200)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      for (let i = 0; i < 40; i++) {
        await sleep(500)
        if (document.querySelectorAll('main .group.flex.items-center').length > 0) break
      }
      const rows = Array.from(document.querySelectorAll('main .group.flex.items-center'))
      out.search = {
        scope: '元数据歌曲',
        count: rows.length,
        titles: rows.slice(0, 5).map((r) => r.textContent.trim().slice(0, 28)),
      }
      const play = Array.from(rows[0]?.querySelectorAll('button') ?? []).find(
        (b) => b.getAttribute('aria-label') === '播放',
      )
      if (play == null) return { ...out, error: '元数据范围没有可播放结果', rowCount: rows.length }
      play.click()
      for (let i = 0; i < 40; i++) {
        await sleep(500)
        if (document.querySelector('footer button[aria-label="暂停"]') != null) break
      }
      out.playback = {
        state: document.querySelector('footer button[aria-label="暂停"]') != null ? 'playing' : 'not-playing',
        title: document.querySelector('footer .truncate')?.textContent?.trim() ?? null,
      }

      // 歌词抽屉
      byAria('button', '歌词')?.click()
      await sleep(1500)
      const lines = Array.from(document.querySelectorAll('[data-lyric-line]'))
      const activeEl = () => document.querySelector('[data-active="true"]')
      const readActive = () => {
        const el = activeEl()
        if (el == null) return null
        const cs = getComputedStyle(el)
        return {
          index: Number(el.dataset.lyricLine),
          timeMs: Number(el.dataset.lyricTime),
          text: el.textContent.trim().slice(0, 26),
          fontSize: cs.fontSize,
          color: cs.color,
          weight: cs.fontWeight,
        }
      }
      out.drawer = {
        lineCount: lines.length,
        emptyText: document.querySelector('main, body')?.textContent?.includes('暂无歌词') ?? false,
      }
      const first = readActive()
      const times = lines.map((el) => Number(el.dataset.lyricTime))
      const pos = () => {
        const t = document.querySelector('footer .tabular-nums')?.textContent?.trim() ?? '0:00'
        const [mm, ss] = t.split(':').map(Number)
        return { text: t, ms: (mm * 60 + ss) * 1000 }
      }
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
        first,
        syncAtFirst: { pos: p1, ...judge(first, p1) },
        after8s: second,
        syncAfter8s: { pos: p2, ...judge(second, p2) },
        advanced: first != null && second != null ? second.index > first.index : null,
        // 滚动跟随：高亮行应落在可视区内
        activeInViewport: (() => {
          const el = activeEl()
          if (el == null) return null
          const scroller = el.closest('.overflow-y-auto')
          if (scroller == null) return null
          const r = el.getBoundingClientRect()
          const c = scroller.getBoundingClientRect()
          return r.top >= c.top - 30 && r.bottom <= c.bottom + 30
        })(),
      }
      out.settingsAppliedToLyrics = {
        fontSizeMatches: first != null && Number.parseFloat(first.fontSize) === out.expect.fontSize,
        colorIsAccent:
          first != null && out.expect.color != null
            ? first.color === out.expect.color.bg
            : null,
      }
      return out
    })()`)

    console.log(JSON.stringify({ report, console: consoleLines.slice(-16) }, null, 1))
  } catch (e) {
    console.log('ERR', e.message)
  } finally {
    ws.close()
    process.exit(0)
  }
})
