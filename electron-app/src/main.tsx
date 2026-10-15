import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { LyricsWindowApp } from './lyrics-window/LyricsWindowApp'
import './index.css'

const rootEl = document.querySelector('#root')
if (!rootEl) throw new Error('#root element missing in index.html')

// 同一个 bundle 服务两个窗口：主窗口 / 独立桌面歌词窗口。
// 歌词窗用透明 BrowserWindow 加载 `#/lyrics-window`，这里按 hash 分流 ——
// 对应 Flutter main.dart 用 WindowController.fromCurrentEngine 分流主/歌词窗。
const isLyricsWindow = window.location.hash.startsWith('#/lyrics-window')
if (isLyricsWindow) {
  // 透明窗口：body 不能有背景色（index.css 里设了浅色底）
  document.documentElement.classList.add('lyrics-window-host')
  document.body.classList.add('lyrics-window-host')
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>{isLyricsWindow ? <LyricsWindowApp /> : <App />}</React.StrictMode>,
)
