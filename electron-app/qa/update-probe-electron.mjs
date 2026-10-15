// 在**真实 Electron 运行时**里跑应用自己的更新器：验证 net.fetch（Chromium 网络栈，
// 遵循系统代理）能真的取到 GitHub Releases 清单，并判断「有没有更新」。
//
// 这是与打包版同一条链路（Electron main + 真实系统代理），比 Node + 假 fetch 更接近线上。
//
// 构建 + 运行：
//   npx esbuild qa/update-probe-electron.mjs --bundle --platform=node --format=esm \
//     --external:electron --outfile=qa/update-probe-electron.bundle.mjs
//   ./node_modules/electron/dist/electron.exe qa/update-probe-electron.bundle.mjs
//
// 注意：**不要**在 Electron 的 ESM main 里用顶层 await app.whenReady() —— 那样 ready
// 永远不触发（Electron 的已知限制），进程会静默挂住。必须用 .then()。
//
// 版本号取自 package.json（app.getVersion()）；想冒充老版本可临时改版本号再跑，
// 例如验证「2.3.5 能否检测到 2.3.6」。
//
// 输出协议：console.log（与 qa/ 下其它探针一致）。
import { app, net } from 'electron'
import { UpdateService } from '../electron/update'

setTimeout(() => {
  console.log('ELECTRON PROBE: TIMEOUT（60s 未完成）')
  app.exit(1)
}, 60000)

app.whenReady().then(async () => {
  const service = new UpdateService()
  const result = await service.check(true)
  console.log(
    'ELECTRON PROBE:',
    JSON.stringify({
      currentVersion: result.currentVersion,
      manifestUrl: service.manifestUrl,
      netFetchAvailable: typeof net.fetch === 'function',
      available: result.available,
      error: result.error,
      remoteVersion: result.remote?.version ?? null,
      downloadUrl: result.remote?.downloadUrl ?? null,
    }),
  )
  app.exit(0)
})
