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
  // 端口必须与 package.json 的 wait-on tcp:5173 / VITE_DEV_SERVER_URL 保持一致；
  // strictPort 让端口冲突直接失败，而不是静默换端口导致 electron:dev 卡住。
  server: { port: 5173, strictPort: true },
})
