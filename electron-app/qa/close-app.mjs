/**
 * 优雅关闭 QA 启动的应用（专供 qa/ 自动化收尾使用）。
 *
 * 为什么不能用 `Stop-Process -Force` 收尾（2026-10 机器蓝屏事件）：
 *   本机会出现 bugcheck 0x119 VIDEO_SCHEDULER_INTERNAL_ERROR（子码 0x3000），
 *   触发点集中在「一个建过 GPU 队列的进程被销毁」时。强行 TerminateProcess
 *   正是最激进的那种销毁方式，等于每次 QA 都在踩同一个雷。
 *   优雅路径：CDP 让窗口自己 close() → 主进程 window-all-closed → app.quit() → 正常退出。
 *
 * 顺序（逐级升级，每级都打印实际用了哪一级）：
 *   1. CDP Runtime.evaluate window.close()
 *   2. 等待进程消失（默认 8s）
 *   3. 仍在 → `taskkill /PID`（无 /F，等于发 WM_CLOSE）
 *   4. 仍在 → `taskkill /F /PID`（最后手段，会打印警告）
 *
 * 用法：
 *   node qa/close-app.mjs [port] [timeoutSeconds]
 *
 * 只关闭「命令行里带 launch-app.cjs 且带本端口」的 electron 进程 —— 不会误杀
 * 用户自己开的 dev 实例或正式安装版（它们的命令行/文件名都不同）。
 */
import { execFileSync } from 'node:child_process'

const port = process.argv[2] ?? '9333'
const waitSeconds = Number(process.argv[3] ?? '8')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 拿到本端口对应的 electron **主**进程 PID 列表（避免误杀 + 避免匹配到自己）
 *  1) 必须限定 Name = electron.exe —— 否则会把「命令行里带这些字面量的 powershell/bash 自己」也匹配进来；
 *  2) 必须排除 --type= —— Chromium 子进程（gpu-process / renderer / utility）命令行里也带端口号；
 *     只关心主进程：它退出了，子进程会跟着被回收。
 */
function findPids() {
  const ps = [
    '-NoProfile',
    '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like '*launch-app.cjs*' -and $_.CommandLine -like '*${port}*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -ExpandProperty ProcessId`,
  ]
  try {
    return execFileSync('powershell', ps, { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
  } catch {
    return []
  }
}

async function alive() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  } catch {
    return false
  }
}

async function gracefulClose() {
  const list = await (
    await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })
  ).json()
  const page = list.find((t) => t.type === 'page' && !t.url.includes('lyrics-window')) ?? list[0]
  if (page == null) return 'no-page'
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws timeout')), 3000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('ws error'))
    })
  })
  ws.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: 'window.close()', returnByValue: true },
    }),
  )
  await sleep(500)
  try {
    ws.close()
  } catch {
    /* ignore */
  }
  return 'sent'
}

async function waitGone(seconds) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    // 主进程消失即成功（子进程会随后被回收；2026-10 实测 window.close() 后 1s 内整棵树都干净了）
    if (findPids().length === 0) return true
    await sleep(400)
  }
  return false
}

const before = findPids()
console.log(`[close-app] port=${port} 初始 PID: ${before.join(',') || '(无)'}`)

let how = 'none'
if (await alive()) {
  how = await gracefulClose()
  console.log(`[close-app] 已发送 window.close()（${how}），等待退出…`)
} else {
  console.log('[close-app] CDP 已不可达，跳过 window.close()')
}

if (await waitGone(waitSeconds)) {
  console.log(`[close-app] OK 优雅退出（未使用强杀），剩余 PID: ${findPids().join(',') || '无'}`)
  process.exit(0)
}

for (const pid of findPids()) {
  try {
    execFileSync('taskkill', ['/PID', pid], { stdio: 'ignore' })
    console.log(`[close-app] 发送 WM_CLOSE: PID ${pid}`)
  } catch {
    /* ignore */
  }
}
if (await waitGone(5)) {
  console.log('[close-app] OK 经 taskkill /PID 退出')
  process.exit(0)
}

const rest = findPids()
console.warn(`[close-app] ⚠️ 优雅路径失败，退化为强杀 PID: ${rest.join(',') || '(无)'}`)
for (const pid of rest) {
  try {
    execFileSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' })
  } catch {
    /* ignore */
  }
}
await waitGone(5)
console.log(`[close-app] 结束，剩余 PID: ${findPids().join(',') || '无'}`)
process.exit(rest.length > 0 ? 0 : 1)
