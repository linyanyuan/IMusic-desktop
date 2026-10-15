// Flutter → electron-app 功能对账取证（本轮新增的三个屏）：
//   我的音乐（四标签页：我喜欢 / 我的歌单 / 播放历史 / 离线缓存）
//   我的主页（用户头部 + 音乐库 + 创建/收藏歌单，未登录给登录入口）
//   专注模式（全幅沉浸：大封面 + 大字号歌词 + 活动行高亮，退出回到来源路由）
//
// 判定全部基于 DOM 断言（不依赖人眼看图）：
//   library.tabs          = 四个标签页齐备
//   library.<tab>Panel    = 每个标签页切过去都有对应面板
//   library.offline       = 离线缓存面板拿到主进程缓存统计（文件数/占用/目录）
//   profile.*             = 头部昵称/@用户名/三个指标（或未登录入口）
//   focus.*               = 专注页存在 + 歌词活动行高亮 + 退出回到来源路由
//
// 用法: node qa/parity-probe.mjs [port] [query]
const port = process.argv[2] ?? '9223'
const query = process.argv[3] ?? '起风了'

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('about:blank'))
if (page == null) {
  console.log(JSON.stringify({ error: 'no page target', list: list.map((t) => t.url) }))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const consoleErrors = []

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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(
      (m.params.args ?? []).map((a) => String(a.value ?? a.description ?? a.type)).join(' ').slice(0, 300),
    )
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(('exception: ' + (m.params.exceptionDetails?.exception?.description ?? '')).slice(0, 300))
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

const shot = async (path) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(path, Buffer.from(r.data, 'base64'))
  return path
}

ws.addEventListener('open', async () => {
  try {
    await send('Runtime.enable')
    await send('Page.enable')
    await send('Page.reload', { ignoreCache: true })
    await new Promise((r) => setTimeout(r, 3500))

    const report = await evalJs(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const tid = (t) => document.querySelector('[data-testid="' + t + '"]')
      const setNative = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      const out = { query: ${JSON.stringify(query)} }

      // ---------- 1) 我的音乐 ----------
      tid('nav-library')?.click(); await sleep(600)
      out.library = { view: tid('library-view') != null }
      const tabs = Array.from(document.querySelectorAll('[data-testid^="library-tab-"]'))
        .map((b) => ({ id: b.getAttribute('data-testid').replace('library-tab-', ''), active: b.getAttribute('data-active') }))
      out.library.tabs = tabs
      const panelFor = { liked: 'library-liked', playlists: 'library-playlists', history: 'library-history', offline: 'library-offline' }
      out.library.panels = {}
      for (const [tab, panel] of Object.entries(panelFor)) {
        const btn = tid('library-tab-' + tab)
        if (btn == null) { out.library.panels[tab] = 'tab-missing'; continue }
        btn.click(); await sleep(450)
        out.library.panels[tab] = tid(panel) != null
        if (tab === 'offline') {
          out.library.offline = {
            fileCount: tid('offline-file-count')?.textContent?.trim() ?? null,
            totalBytes: tid('offline-total-bytes')?.textContent?.trim() ?? null,
            directory: (Array.from(document.querySelectorAll('[data-testid="library-offline"] div'))
              .map((d) => d.textContent.trim())
              .find((t) => t.startsWith('缓存目录：')) ?? '').slice(0, 140) || null,
          }
        }
        if (tab === 'playlists') {
          out.library.playlistCards = document.querySelectorAll('[data-testid="library-playlists"] > div > button').length
        }
        if (tab === 'history') {
          out.library.historyCount = document.querySelectorAll('[data-testid="library-history"] .group.flex.items-center').length
        }
        if (tab === 'liked') {
          out.library.likedCount = document.querySelectorAll('[data-testid="library-liked"] .group.flex.items-center').length
        }
      }
      // 切回喜欢页，供后面"退出专注回到来源路由"断言
      tid('library-tab-liked')?.click(); await sleep(300)
      out.library.backToLiked = tid('library-view') != null

      // ---------- 2) 我的主页 ----------
      tid('nav-profile')?.click(); await sleep(600)
      out.profile = {
        view: tid('profile-view') != null,
        loggedIn: tid('profile-nickname') != null,
        nickname: tid('profile-nickname')?.textContent?.trim() ?? null,
        username: tid('profile-username')?.textContent?.trim() ?? null,
        loginEntry: tid('profile-login-entry') != null,
        likedCard: tid('profile-liked-card') != null,
        historyCard: tid('profile-history-card') != null,
        metrics: Array.from(document.querySelectorAll('[data-testid="profile-view"] .tabular-nums'))
          .map((e) => e.textContent.trim()),
        createdSection: tid('profile-created') != null,
        collectedSection: tid('profile-collected') != null,
      }

      // ---------- 3) 搜歌 → 播放（专注页要有歌词可断言）----------
      tid('nav-search')?.click(); await sleep(500)
      // 选「元数据歌曲」scope（netease 直链 + 有 LRC，专注页歌词才可断言）
      const scopeBtn = Array.from(document.querySelectorAll('main button'))
        .find((b) => b.textContent.trim() === '元数据歌曲')
      out.scopeClicked = scopeBtn != null
      scopeBtn?.click(); await sleep(400)
      const input = document.querySelector('main input[placeholder*="搜索"]')
      if (input != null) {
        setNative.call(input, ${JSON.stringify(query)})
        input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(200)
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        for (let i = 0; i < 60; i++) {
          await sleep(500)
          if (document.querySelectorAll('main .group.flex.items-center').length > 0) break
        }
        const rows = Array.from(document.querySelectorAll('main .group.flex.items-center'))
        out.searchRows = rows.length
        const play = rows[0] != null ? Array.from(rows[0].querySelectorAll('button')).find((b) => b.getAttribute('aria-label')?.includes('播放')) : null
        play?.click()
        // 等真的在播（footer 暂停按钮 = 正在播放）
        for (let i = 0; i < 80; i++) {
          await sleep(500)
          if (document.querySelector('footer button[aria-label="暂停"]') != null) break
        }
      }
      out.playing = document.querySelector('footer button[aria-label="暂停"]') != null
      out.nowPlaying = document.querySelector('footer .truncate')?.textContent?.trim() ?? null

      // ---------- 4) 专注模式 ----------
      // 从「我的音乐」进入，验证退出时回到来源路由
      tid('nav-library')?.click(); await sleep(600)
      tid('focus-toggle')?.click(); await sleep(900)
      out.focus = {
        view: tid('focus-view') != null,
        cover: tid('focus-cover') != null,
        lyricsPane: tid('focus-lyrics') != null,
        exitBtn: tid('focus-exit') != null,
      }
      const lines = Array.from(document.querySelectorAll('[data-testid="focus-lyrics"] [data-lyric-line]'))
      const activeLine = lines.find((l) => l.getAttribute('data-active') === 'true') ?? null
      out.focus.lyricLines = lines.length
      out.focus.activeLyric = activeLine != null
        ? { index: Number(activeLine.getAttribute('data-lyric-line')), time: Number(activeLine.getAttribute('data-lyric-time')), text: activeLine.textContent.trim().slice(0, 40) }
        : null
      await sleep(6000)
      out.focus.activeScroll = (() => {
        const c = tid('focus-lyrics')
        if (c == null) return null
        return { scrollTop: Math.round(c.scrollTop), scrollHeight: c.scrollHeight, clientHeight: c.clientHeight }
      })()
      // 歌词高亮是否跟着播放推进
      const active2 = lines.find((l) => l.getAttribute('data-active') === 'true') ?? null
      out.focus.activeAdvanced =
        active2 != null &&
        activeLine != null &&
        Number(active2.getAttribute('data-lyric-line')) > Number(activeLine.getAttribute('data-lyric-line'))
      out.focus.activeTime = active2 != null ? Number(active2.getAttribute('data-lyric-time')) : null

      // 退出专注 → 回到来源路由（library）
      tid('focus-exit')?.click(); await sleep(700)
      out.focus.afterExit = {
        focusGone: tid('focus-view') == null,
        backToLibrary: tid('library-view') != null,
        playingStill: document.querySelector('footer button[aria-label="暂停"]') != null,
      }

      return out
    })()`)

    await shot('qa/parity-library.png')
    await evalJs(`document.querySelector('[data-testid="nav-profile"]')?.click()`)
    await new Promise((r) => setTimeout(r, 700))
    await shot('qa/parity-profile.png')
    await evalJs(`document.querySelector('[data-testid="focus-toggle"]')?.click()`)
    await new Promise((r) => setTimeout(r, 900))
    await shot('qa/parity-focus.png')

    const lib = report.library ?? {}
    const focus = report.focus ?? {}
    const pass =
      lib.view === true &&
      Array.isArray(lib.tabs) &&
      lib.tabs.length === 4 &&
      Object.values(lib.panels ?? {}).every((v) => v === true) &&
      focus.view === true &&
      focus.exitBtn === true &&
      focus.afterExit?.focusGone === true &&
      focus.afterExit?.backToLibrary === true &&
      (report.playing !== true || (focus.lyricLines ?? 0) > 0)

    console.log(JSON.stringify({ pass, report, consoleErrors: consoleErrors.slice(0, 8) }, null, 2))
    ws.close()
    process.exit(pass ? 0 : 2)
  } catch (e) {
    console.log(JSON.stringify({ error: String(e), consoleErrors: consoleErrors.slice(0, 8) }, null, 2))
    process.exit(1)
  }
})
