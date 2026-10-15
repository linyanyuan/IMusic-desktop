# IMusic Desktop Electron 重构 — 技术设计文档

日期：2026-10-14
配套需求文档：`docs/2026-10-14-electron-ui-rewrite-requirements.md`

## 1. 总体架构

```
┌─ Electron 主进程 (electron/) ────────────────────────────────┐
│  main.ts          窗口创建（frameless）、session 头注入、CSP      │
│  headers.ts       onBeforeSendHeaders：B站域名 Referer 注入       │
│  cacheProtocol.ts bilimusic-audio:// 特权协议（Range + 校验）     │
│  audioCache.ts    缓存下载/查找/清理（并发 2 + 原子替换）          │
│  windowIpc.ts     minimize/maximize/close、歌词窗口（M5+）        │
│  preload.cjs      contextBridge 暴露 window.imusicAPI             │
└─────────────────── IPC (contextBridge) ──────────────────────┘
┌─ 渲染层 React (src/) ─────────────────────────────────────────┐
│  contexts/    PlayerContext（播放引擎） LibraryContext（曲库）     │
│               AuthContext（账号）   SettingsContext（设置）        │
│  services/    【移植层，纯 TS、可 node --test 单测】               │
│    models.ts / http.ts / gdstudio.ts / meting.ts / chksz.ts /    │
│    bilibili.ts / hybrid.ts / musicService.ts / library.ts /      │
│    auth.ts / appSettings.ts                                      │
│  components/  Sidebar MainContent PlayerBar TitleBar ...         │
│  views/       HomeView SearchView FavoritesView HistoryView      │
│               PlaylistDetailView SettingsView                    │
│  styles/      tokens.css（设计 token） + Tailwind4                │
└───────────────────────────────────────────────────────────────┘
```

**关键架构决策**：音乐数据请求放在渲染层（fetch），B 站域名由主进程 session 层统一注入 `Referer` 并剥离 Cookie —— 因此 `<audio src="B站CDN直链">` 可直接流播。这是相对 Flutter 端（必须先整首下载）的最大行为改进。仅 `bilimusic-audio://` 本地协议与缓存写入走主进程。

## 2. 技术栈

与 BiliMusic 对齐：Electron 36 · React 19 · TypeScript 5.8 · Tailwind CSS 4（@tailwindcss/vite）· Vite 6 + vite-plugin-electron · framer-motion · lucide-react · electron-builder（NSIS）。

UI 提示词 md 中的 Vue3/Pinia 描述按用户决策替换为 React/Context，设计 token 原样保留。

## 3. 目录结构

```
electron-app/
├── package.json  vite.config.ts  tsconfig.json  tsconfig.electron.json  index.html
├── electron/
│   ├── main.ts  headers.ts  cacheProtocol.ts  audioCache.ts  windowIpc.ts
│   └── preload.cjs
├── src/
│   ├── main.tsx  App.tsx
│   ├── styles/tokens.css  index.css
│   ├── contexts/  PlayerContext.tsx  LibraryContext.tsx  AuthContext.tsx  SettingsContext.tsx
│   ├── services/  models.ts http.ts gdstudio.ts meting.ts chksz.ts bilibili.ts
│   │              hybrid.ts musicService.ts library.ts auth.ts appSettings.ts
│   ├── components/ Sidebar.tsx TitleBar.tsx PlayerBar.tsx SongTable.tsx CoverCard.tsx
│   │               QueueDrawer.tsx LyricsDrawer.tsx NewPlaylistModal.tsx ContextMenu.tsx
│   └── views/ HomeView.tsx SearchView.tsx FavoritesView.tsx HistoryView.tsx
│              PlaylistDetailView.tsx SettingsView.tsx
└── tests/  hybrid.test.cjs  library.test.cjs ...
```

## 4. Dart → TypeScript 模块映射

| Flutter（lib/） | electron-app（src/services 等） | 说明 |
|---|---|---|
| `core/models/song.dart` | `services/models.ts` | Song/Playlist/PlaybackUrl/PlaybackPage/SearchPageResult，TS interface；`Song.fromMap` → `songFromMap` |
| `services/music_provider.dart` | `services/musicProvider.ts` | MusicProvider/MusicSearchProvider 抽象 + `MusicSearchScope`（all/metadataSongs/bilibiliPlaylists/chkszSongs） |
| `services/gdstudio_client.dart` + `gdstudio_music_provider.dart` | `services/gdstudio.ts` | fetch 移植；headers 为空 → 直链流播 |
| `services/meting_music_provider.dart`（+ default） | `services/meting.ts` | 元数据源，Fallback 链保留 |
| `services/chksz_music_provider.dart` | `services/chksz.ts` | 163_search/163_music/163_playlist 解析结构按 memory #10；key 缺失抛 `ChkszApiKeyMissingError` |
| `services/bilibili_music_provider.dart` | `services/bilibili.ts` | 搜索→view→playurl(fnval=16) 取 DASH 音频；avid+cid 404 回退；歌词接口 |
| `services/hybrid_music_provider.dart` | `services/hybrid.ts` | 元数据/播放双源融合、`_matchScore` 模糊匹配、标题回退逐条 1:1 |
| `services/music_service.dart` | `services/musicService.ts` | id 前缀分派（`gdstudio:` / `bilibili:` / `meting:` / `chksz:`）、rememberSongs 缓存、PlaybackUrl 组装（headers 判定） |
| `services/library_service.dart` | `services/library.ts` + `contexts/LibraryContext.tsx` | 本地持久化（localStorage）+ 服务端同步；乐观更新 + mutation 队列 + generation/entity claim 语义保留 |
| `services/auth_service.dart` | `services/auth.ts` + `contexts/AuthContext.tsx` | login/register/getMe/logout；token 持久化 |
| `services/app_settings.dart` | `services/appSettings.ts` | chkszApiKey / cacheDirectory / retentionDays 等；localStorage |
| `services/audio_cache_service.dart` | `electron/audioCache.ts` | getOrDownload/findCached/invalidate/clearExpired；并发 2 + `.part` 原子替换（借鉴 BiliMusic） |
| `playback/playback_actions.dart` + `playback_providers.dart` + `playback_commands.dart` | `contexts/PlayerContext.tsx` | requestSerial → AbortController；loadedPlayback 语义保留 |
| `desktop/desktop_app_shell.dart` + screens/widgets | `App.tsx` + views/ + components/ | in-shell 状态路由（DeskRoute → `ViewRoute` union type） |
| `lyrics_window/*`（desktop_multi_window） | M5+ Electron BrowserWindow | 本轮仅 LyricsDrawer |
| `services/update_service.dart` | M5+ electron-updater | 本轮不做 |

## 5. 播放引擎设计（PlayerContext）

单例 `HTMLAudioElement`，仿 BiliMusic `src/contexts/PlayerContext.tsx`：

- **source 生命周期**：每次切歌新建 `AbortController`；旧 controller 一律 abort，晚到的异步结果不得生效（对应 Flutter 的 `requestSerial`）。
- **开播流程**：`stop → getPlayUrl(musicService) → audio.src = url → waitForMetadata(20s) → startPlayback(12s)`；headers 非空的 URL（B 站）直接流播（主进程已注入 Referer）；缓存命中走 `bilimusic-audio://local/<token>`。
- **抗抖动**：`error` 或 `stalled/waiting` 12s 看门狗 → `recover()`（最多 2 次，续播当前进度，重新 getPlayUrl 刷新签名 URL）；切歌/暂停用 150ms smoothstep `fadeVolume` 防爆音。
- **播放模式**：list / single / shuffle（对应 Flutter PlayMode）；`ended` → 按模式推进队列。
- **断点记忆**：>15min 音频 localStorage 记忆位置（对应 BiliMusic playback.ts 的 bookmark）。
- **进度/状态暴露**：`timeupdate` → currentTime/duration state；歌词组件订阅进度做行高亮。

## 6. 主进程设计

- **headers.ts**：一个 `onBeforeSendHeaders` 监听器覆盖 `hdslb.com / bilivideo.com / bilivideo.cn / akamaized.net / bilibili.com`，删 Cookie、加 `Referer: https://www.bilibili.com`（注意：同 session 只能注册一个，API 与 CDN 头处理必须合并，否则音频 403 —— BiliMusic 实测坑）。
- **cacheProtocol.ts**：`protocol.registerSchemesAsPrivileged([{scheme:'bilimusic-audio', privileges:{standard:true,secure:true,stream:true}}])`；handler 校验 token → Range 解析（206/416）→ 流式读文件；防半截文件（size 校验）。
- **audioCache.ts**：IPC `imusic:cacheGetOrDownload / invalidate / stats / clear / clearExpired`；并发 2；`.part` + rename 原子替换。
- **windowIpc.ts**：`imusic:winMinimize / winMaximize / winClose / winIsMaximized`。
- **preload.cjs**：`contextBridge.exposeInMainWorld('imusicAPI', {...})`，类型在 `src/types/imusic-api.d.ts` 声明。

## 7. 状态管理

React Context + hooks（不引 Redux/Zustand）：

- `PlayerContext`：currentSong、queue、index、isPlaying、currentTime、duration、volume、playMode、playSong(song, queue)/togglePlay/next/prev/seek/setVolume/toggleLike 转发。
- `LibraryContext`：likedIds、favorites、playlists、history；乐观更新 + mutation 队列（移植 generation/claim 语义防并发覆盖）。
- `AuthContext`：user/token/isLoading；登录后触发 library 远端拉取。
- `SettingsContext`：chkszApiKey、cacheDirectory、主题 token。
- 路由：`App.tsx` 内 `ViewRoute = {kind:'home'|'search'|'favorites'|'history'|'settings'} | {kind:'playlist', id}` state 驱动，对应 Flutter 的 DeskRoute。

## 8. 设计 token（styles/tokens.css）

```css
:root {
  --bg-main:#FFFFFF; --bg-sidebar:#F5F5F7; --text-primary:#1D1D1F; --text-secondary:#86868B;
  --accent:#FA233B; --accent-hover:#E01E34; --border:#E5E5EA;
  --playerbar-bg:rgba(255,255,255,.8); --radius-banner:16px; --radius-cover:12px; --radius-item:8px;
}
```
Tailwind4 `@theme` 映射同名 utility（`bg-accent`、`text-secondary` 等），组件内不再散落 hex。

## 9. 搜索范围（MusicSearchScope）与 id 前缀

- `all`：混合（元数据源单曲 + B 站歌单 + ChKSz 单曲）。
- `metadataSongs`：GDStudio/Meting 单曲。
- `bilibiliPlaylists`：B 站合集/歌单。
- `chkszSongs`：ChKSz 网易云单曲（key 缺失 → UI 提示去设置页配置，而非静默空列表）。
- id 前缀分派：`gdstudio:{source}:{id}` 直链；`bilibili:{bvid}` 或 `bilibili:{bvid}?p=N`；`meting:{source}:{id}` 元数据+模糊匹配回退；`chksz:{id}`。

## 10. 测试策略

- `node --test tests/*.test.cjs`（沿用 BiliMusic 方式，services 层不依赖 DOM）：
  - hybrid：id 前缀分派、`_matchScore` 边界（同名不同长、括号标记、artist 权重）。
  - library：乐观更新回滚、mutation 队列顺序、取消语义。
  - chksz/gdstudio/meting 解析：锁定真实响应 fixture（按 memory #10 的结构）。
- 播放引擎手测清单：三类音源开播、B 站 seek、断网恢复、快速连点切歌。
- 构建：`npm run typecheck`（双 tsconfig）+ `vite build`。

## 11. 里程碑映射

M0 骨架（§3）→ M1 服务层（§4）→ M2 播放引擎（§5/§6）→ M3 UI 主体（§7/§8）→ M4 抽屉与设置 → M5 打磨发布。详见需求文档 §4。
