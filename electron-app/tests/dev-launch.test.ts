// 「启动即退」回归锁定：dev 模式下 Electron 只能有一个 launcher。
//
// 背景：vite.config.ts 注册了 vite-plugin-electron，插件在 dev server 就绪后**自行**
// spawn electron（插件默认 argv 就是 ['.', '--no-sandbox']）。而 package.json 的
// electron:dev 曾经用 concurrently 再手动 spawn 一个 `electron .`：
//
//   [1] ... electron . exited with code 0
//   --> Sending SIGTERM to other processes..
//   [0] vite exited with code 1
//
// 第二个实例 requestSingleInstanceLock() 失败 → app.quit() → 状态码 0 静默退出 →
// `concurrently -k` 认为「有一个任务结束了」于是杀掉 vite，而 vite 退出又会 treeKill
// 插件起的那个 electron —— 整个 dev 会话在 1~2 秒内自我了结，一个窗口都留不下。
//
// 所以这里锁两件事：dev 脚本不许自己 spawn electron；插件不许被 onstart 关掉自动启动。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import pkg from '../package.json'

// dev 与 electron:dev 是同一件事的两个入口（都走插件启动 Electron），一起锁。
const launchScripts = ['dev', 'electron:dev'] as const

test('dev / electron:dev 只走 vite，不自己 spawn Electron', () => {
  for (const name of launchScripts) {
    const script = String(pkg.scripts[name])
    assert.ok(
      !/\belectron\s+\./.test(script.replace(/vite-plugin-electron/g, '')),
      `script "${name}" 不应直接启动 electron（会与插件双启动）：${script}`,
    )
    assert.ok(
      !script.includes('concurrently'),
      `script "${name}" 不应并发跑 vite 与 electron（双启动 → 静默 exit 0 → 杀 vite）：${script}`,
    )
  }
})

test('electron:dev 先备好 preload，再起 vite（插件启动的 Electron 读 dist-electron/preload.cjs）', () => {
  const script = String(pkg.scripts['electron:dev'])
  assert.match(script, /copy-preload/, 'preload.cjs 必须在 Electron 启动前进到 dist-electron')
  assert.ok(
    script.indexOf('copy-preload') < script.indexOf('vite'),
    `copy-preload 必须先于 vite 执行：${script}`,
  )
})

test('vite.config.ts 保留 vite-plugin-electron 且未用 onstart 关掉自动启动', () => {
  // 测试先被 esbuild 打成 tests/dist/*.cjs，import.meta.url 不可用，按包根（npm test 的 cwd）定位
  const config = readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8')
  assert.match(config, /from 'vite-plugin-electron'/, 'dev 下 main.ts 的 watch 构建 + Electron 启动靠这个插件')
  assert.ok(
    !config.includes('onstart'),
    '传了 onstart 插件就不再自动 startup()，此时 electron:dev 必须改回手动启动（二者只能留一个）',
  )
})
