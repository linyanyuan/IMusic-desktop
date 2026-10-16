import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron'
import { builtinModules } from 'module'
import path from 'path'

// 主进程需外部化的运行时依赖，不能被 esbuild 打进 main.js
const electronExternals = [
  'electron',
  'electron-updater',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]

export default defineConfig({
  plugins: [
    {
      name: 'development-csp',
      transformIndexHtml(html, context) {
        return context.server
          ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
          : html
      },
    },
    react(),
    tailwindcss(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: { external: electronExternals },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          motion: ['framer-motion'],
        },
      },
    },
  },
  // 注意：Electron 由上面的 vite-plugin-electron 在 dev server 就绪后自行 spawn（并由插件
  // 注入 VITE_DEV_SERVER_URL），所以 electron:dev 只跑 vite。dev 脚本里再手动 spawn 一个
  // electron 会撞单实例锁 → 以状态码 0 静默退出 → 把 vite 一起带走（表现为「启动即退」）。
  // strictPort 让端口冲突直接失败，而不是静默换端口让 CDP/QA 脚本连错端口。
  server: { port: 5173, strictPort: true },
})
