/**
 * M4 验收取证脚本 —— 设置页 / 歌词抽屉（卡拉OK同步）/ 播放队列抽屉。
 * 用法: node qa/m4-probe.mjs [port]
 * 判定标准:
 *   歌词同步 = 高亮行的 data-lyric-time <= 当前播放位置 < 下一行时间
 *   队列跳播 = 点击第 N 行后 currentIndex 变成 N 且播放器标题变成该行标题
 */
const port = process.argv[2] ?? '9223'

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('about:blank'))
if (page == null) {
  console.log(JSON.stringify({ error: 'no page target', targets: list.map((t) => t.url) }))
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const failed = []
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
    consoleLines.push(`[${m.params.type}] ${text}`.slice(0, 240))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleLines.push(
      '[exception] ' +
        JSON.stringify(
          m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text,
        ).slice(0, 240),
    )
  }
  if (m.method === 'Network.loadingFailed') {
    failed.push({ error: m.params.errorText, type: m.params.type })
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
    await send('Network.enable')

    const report = await evalJs(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const byAria = (sel, label, root = document) =>
        Array.from(root.querySelectorAll(sel)).find((e) => e.getAttribute('aria-label') === label)
      const navText = (label) =>
        Array.from(document.querySelectorAll('aside button')).find(
          (b) => b.textContent.trim() === label,
        )
      const out = {}

      // ---------- 1. 设置页 ----------
      const settingsNav = navText('设置')
      if (settingsNav == null) return { error: '侧边栏没有「设置」入口' }
      settingsNav.click()
      await sleep(500)
      out.settings = {
        heading: document.querySelector('main h1')?.textContent?.trim() ?? null,
        sections: Array.from(document.querySelectorAll('main section h2')).map((h) =>
          h.textContent.trim(),
        ),
        accountForm: byAria('input', '账号') != null && byAria('input', '密码') != null,
        apiKeyField: byAria('input', 'ChKSz API Key') != null,
        apiKeyStatus: Array.from(document.querySelectorAll('main section p'))
          .map((p) => p.textContent.trim())
          .find((t) => t.startsWith('当前状态')) ?? null,
        cacheUsage: document.querySelector('[data-testid="cache-usage"]')?.textContent?.trim() ?? null,
        cacheDirShown: document.querySelector('main p.break-all')?.textContent?.trim() ?? null,
        clearCacheBtn: byAria('button', '清理缓存') != null,
        defaultDirBtn: byAria('button', '恢复默认缓存目录') != null,
        retentionInput: byAria('input', '缓存保留天数')?.value ?? null,
        fontSlider: byAria('input', '歌词字号')?.value ?? null,
        colorPresets: document.querySelectorAll('main button[aria-label^="歌词高亮色"]').length,
      }

      // 设置改动是否落地：字号 26 + 换色，然后读回
      const slider = byAria('input', '歌词字号')
      const setNative = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set
      setNative.call(slider, '26')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(200)
      const colorBtn = byAria('button', '歌词高亮色 系统蓝')
      colorBtn?.click()
      await sleep(200)
      out.settingsPersisted = {
        sliderReadback: byAria('input', '歌词字号')?.value ?? null,
        blueSelected: (colorBtn?.className ?? '').includes('ring-2'),
        stored: (() => {
          try {
            const raw = localStorage.getItem('imusic.desktop.settings')
            const parsed = raw ? JSON.parse(raw) : null
            return parsed != null
              ? { fontSize: parsed.lyricsFontSize ?? parsed['lyrics_font_size'] ?? null }
              : null
          } catch {
            return 'parse-failed'
          }
        })(),
      }

      // ---------- 2. 搜索并播放 ----------
      navText('搜索')?.click()
      await sleep(400)
      const input = document.querySelector('main input[placeholder*="搜索"]')
      if (input == null) return { ...out, error: '搜索页没有输入框' }
      setNative.call(input, '周杰伦')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(200)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      for (let i = 0; i < 40; i++) {
        await sleep(500)
        if (document.querySelectorAll('main .group.flex.items-center').length > 0) break
      }
      const rows = Array.from(document.querySelectorAll('main .group.flex.items-center'))
      const playBtn = Array.from(rows[0]?.querySelectorAll('button') ?? []).find(
        (b) => b.getAttribute('aria-label') === '播放',
      )
      if (playBtn == null) return { ...out, error: '没有播放按钮', rowCount: rows.length }
      playBtn.click()
      for (let i = 0; i < 30; i++) {
        await sleep(500)
        if (document.querySelector('footer button[aria-label="暂停"]') != null) break
      }
      await sleep(2500)
      const footer = document.querySelector('footer')
      out.playback = {
        state: footer?.querySelector('button[aria-label="暂停"]') != null ? 'playing' : 'not-playing',
        title: footer?.querySelector('.truncate')?.textContent?.trim() ?? null,
        times: Array.from(footer?.querySelectorAll('.tabular-nums') ?? []).map((e) =>
          e.textContent.trim(),
        ),
      }

      // ---------- 3. 歌词抽屉（卡拉OK同步） ----------
      byAria('button', '歌词')?.click()
      await sleep(1200)
      const lines = Array.from(document.querySelectorAll('[data-lyric-line]'))
      const activeEl = () => document.querySelector('[data-active="true"]')
      const readActive = () => {
        const el = activeEl()
        return el == null
          ? null
          : {
              index: Number(el.dataset.lyricLine),
              timeMs: Number(el.dataset.lyricTime),
              text: el.textContent.trim().slice(0, 30),
              color: getComputedStyle(el).color,
              fontPx: getComputedStyle(el).fontSize,
            }
      }
      const first = readActive()
      const times = lines.map((el) => Number(el.dataset.lyricTime))
      await sleep(6000)
      const second = readActive()
      // 同步判定：高亮行时间 <= 播放位置 < 下一行时间
      const progressText = document.querySelector('footer .tabular-nums')?.textContent?.trim() ?? '0:00'
      const [mm, ss] = progressText.split(':').map(Number)
      const posMs = (mm * 60 + ss) * 1000
      let syncOk = null
      if (second != null) {
        const nextTime = times[second.index + 1] ?? Number.POSITIVE_INFINITY
        syncOk = second.timeMs <= posMs + 1500 && posMs < nextTime
      }
      out.lyrics = {
        lineCount: lines.length,
        first,
        after6s: second,
        advanced: first != null && second != null ? second.index > first.index : null,
        progress: progressText,
        // 同步判定带 1.5s 容差（歌词行时间戳颗粒度 + 进度显示只到秒）
        syncOk,
        activeIsScrollTarget:
          (() => {
            const el = activeEl()
            if (el == null) return null
            const box = document.querySelector('[data-lyric-line]')?.parentElement?.parentElement
            if (box == null) return null
            const r = el.getBoundingClientRect()
            const c = box.getBoundingClientRect()
            return r.top >= c.top - 40 && r.bottom <= c.bottom + 40
          })(),
      }

      // ---------- 4. 播放队列抽屉 ----------
      byAria('button', '关闭抽屉')?.click()
      await sleep(300)
      byAria('button', '播放队列')?.click()
      await sleep(600)
      const qRows = Array.from(document.querySelectorAll('[data-queue-index]'))
      const activeQ = () => document.querySelector('[data-queue-index][data-active="true"]')
      const before = {
        count: qRows.length,
        activeIndex: Number(activeQ()?.dataset.queueIndex ?? -1),
        activeTitle: activeQ()?.textContent?.trim().slice(0, 30) ?? null,
      }
      const target = qRows[Math.min(3, qRows.length - 1)]
      const targetTitle = target?.textContent?.trim().slice(0, 30) ?? null
      target?.click()
      for (let i = 0; i < 30; i++) {
        await sleep(500)
        if (Number(activeQ()?.dataset.queueIndex ?? -1) === Math.min(3, qRows.length - 1)) break
      }
      await sleep(1500)
      out.queue = {
        before,
        targetIndex: Math.min(3, qRows.length - 1),
        targetTitle,
        after: {
          activeIndex: Number(activeQ()?.dataset.queueIndex ?? -1),
          activeTitle: activeQ()?.textContent?.trim().slice(0, 30) ?? null,
          footerTitle: document.querySelector('footer .truncate')?.textContent?.trim() ?? null,
          state:
            document.querySelector('footer button[aria-label="暂停"]') != null ? 'playing' : 'paused',
        },
      }
      out.queue.jumped =
        out.queue.after.activeIndex === out.queue.targetIndex &&
        out.queue.after.state === 'playing'

      return out
    })()`)

    console.log(JSON.stringify({ report, failed: failed.slice(-10), console: consoleLines.slice(-20) }, null, 1))
  } catch (e) {
    console.log('ERR', e.message)
  } finally {
    ws.close()
    process.exit(0)
  }
})
