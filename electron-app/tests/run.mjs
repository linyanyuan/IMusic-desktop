// electron-app 测试入口：把 tests/*.test.ts 用 esbuild 打成 CJS 再交给 node --test。
//
// 为什么要先打包：源码是 TS + 无扩展名相对导入（'./models'），Node 原生 ESM 解析不了
// 这种 specifier；esbuild 顺手完成 TS→JS 与依赖图解析，也不用为测试引入 tsx/vitest。
//
// 用法: npm test   （或 node tests/run.mjs）
// 只跑某一个文件: npm test -- lyrics

import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, 'dist')
const filter = process.argv[2]

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const files = readdirSync(here).filter(
  (name) => name.endsWith('.test.ts') && (filter == null || name.includes(filter)),
)
if (files.length === 0) {
  console.error(`没有匹配的测试文件${filter != null ? `（filter=${filter}）` : ''}`)
  process.exit(1)
}

for (const file of files) {
  // external: 'electron' —— electron/update.ts 顶层 import { app } from 'electron'，
  // 在纯 node 下这一步只是拿到 electron 可执行文件路径字符串，测试里不会调用主进程 API。
  await build({
    entryPoints: [path.join(here, file)],
    outfile: path.join(outDir, file.replace(/\.ts$/, '.cjs')),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
    logLevel: 'warning',
  })
}

const bundles = files.map((name) => path.join(outDir, name.replace(/\.ts$/, '.cjs')))
// 显式传文件列表：node --test <dir> 在 Node 24 下会被当成要加载的模块（MODULE_NOT_FOUND），
// 而 spawnSync 不带 shell 也不会展开 glob。
const runner = spawnSync(process.execPath, ['--test', ...bundles], { stdio: 'inherit' })
process.exit(runner.status ?? 1)
