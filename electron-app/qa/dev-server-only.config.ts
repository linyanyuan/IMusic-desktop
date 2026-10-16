/**
 * 【临时调试用，勿提交】只跑 vite dev server，不要 vite-plugin-electron 自动拉起 Electron。
 *
 * 为什么要它：vite.config.ts 里的 vite-plugin-electron 会在 dev server 就绪后自己 spawn
 * 一个 Electron（用真实 userData），于是没法给那个实例加 --remote-debugging-port，
 * 也就看不到渲染进程的 console/网络错误。这里复用 vite.config.ts，仅剔除 electron 插件，
 * 由 qa/dev-cdp-launch.cjs 单独起一个带 CDP 的实例。
 */
import base from '../vite.config'
import type { PluginOption } from 'vite'

const config = base as { plugins?: PluginOption[] }

const isElectronPlugin = (p: PluginOption): boolean => {
  const list = Array.isArray(p) ? p.flat(Infinity) : [p]
  return list.some((x) => (x as { name?: string } | null)?.name === 'vite-plugin-electron')
}

export default {
  ...config,
  plugins: (config.plugins ?? []).filter((p) => !isElectronPlugin(p)),
}
