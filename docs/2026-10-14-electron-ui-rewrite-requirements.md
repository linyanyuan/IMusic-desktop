# IMusic Desktop Electron 前端重构 — 迭代开发需求文档

日期：2026-10-14
分支：`feat/electron-ui-rewrite`
状态：进行中

## 1. 背景与目标

Flutter 版桌面端（`lib/desktop`）技术栈受插件生态限制（Windows audioplayers 不支持自定义请求头 → B 站音源必须先整首下载才能播；UI 迭代成本高）。参考 [Withnoidea/BiliMusic](https://github.com/Withnoidea/BiliMusic)（Electron 36 + React 19 + TS + Tailwind 4 + Vite 6）与 UI 原型 [frosted-play-room.lovable.app](https://frosted-play-room.lovable.app)，将前端整体重构为 Electron 应用：

- **技术栈与 BiliMusic 一致**：Electron 36 / React 19 / TypeScript / Tailwind CSS 4 / Vite 6 / framer-motion / lucide-react / electron-builder。
- **后端业务逻辑功能不变**：多音源（GDStudio / Meting / ChKSz 网易云 / Bilibili）、曲库同步（登录、喜欢、歌单）、搜索范围（MusicSearchScope）、id 前缀分派与模糊匹配回退等行为 1:1 移植到 TypeScript。
- **UI 按原型规范**：macOS Apple Music 极简浅色风格（Frosted Play Room），设计规范见 `C:\Users\admin\Downloads\gemini-code-1791982689272.md`（提示词中框架写 Vue，按用户决策以 BiliMusic 的 React 栈实现，设计 token 不变）。
- **顺带修复 Flutter 端硬伤**：Electron 主进程 `session.webRequest.onBeforeSendHeaders` 注入 Referer，B 站音源改为**直链流播**，不再"先下完再播"。

## 2. 范围

### 做（In Scope）
- 新工程 `electron-app/`（Electron 主进程 + preload + React 渲染层）。
- 服务层 TS 移植：models / providers / MusicService / HybridMusicProvider / LibraryService / AuthService / AppSettings / AudioCache。
- 播放引擎：HTML5 `<audio>` 单实例 + 抗抖动（重试、stalled 看门狗、超时、crossfade）+ 播放模式（列表循环/单曲/随机）。
- UI：Sidebar / MainContent / Home / Search / Favorites / History / PlaylistDetail / PlayerBar / 播放队列与歌词抽屉 / 无边框窗口自定义标题栏。
- 设置页：音源配置（ChKSz key）、缓存目录、账号登录。

### 不做（Out of Scope，后续迭代）
- ~~独立桌面歌词窗口~~（已在 M6 落地：Electron 第二 BrowserWindow，见 M6 表）。
- 下载管理（ffmpeg 转码/ID3 标签）。
- ~~自动更新~~（已落地为自研 zip 更新器）、托盘、~~全局快捷键~~（已落地）。
- Flutter 端的下线与数据迁移（两版并存，本地数据格式各自独立）。

## 3. 设计规范（摘要，以原型站与提示词 md 为准）

- 色彩：主区 `#FFFFFF`；侧栏 `#F5F5F7`/85% + `backdrop-blur-xl`；播控栏 `white/80` + `backdrop-blur-2xl`；主文字 `#1D1D1F`；次文字 `#86868B`；强调色 `#FA233B`（hover `#E01E34`，选中底 `#FA233B/10`）；边框 `#E5E5EA`。
- 圆角：banner `rounded-2xl`、封面 `rounded-xl`、列表缩略图/按钮 `rounded-lg`。
- 布局：`h-screen overflow-hidden flex flex-col select-none`，仅主内容区内部滚动；侧栏固定 `w-[240px]`；播控栏固定高 `76px` 三栏 `grid-cols-3`。
- 视图：首页（Hero 双列 banner、最近播放 5 列、收藏快捷 6 首双列）、搜索（分类浏览 + 最近搜索 → 关键词 Tab 结果）、我喜欢的/歌单详情（192px 封面 + 播放全部/随机 + 极简表格）、历史（清空 + 相对时间列）。
- 窗口：无边框（frameless），自绘 最小化/最大化/关闭 按钮。

## 4. 迭代计划

### M0 — 工程骨架 ✅(本轮)
- 分支、文档、`electron-app/` 脚手架（vite-plugin-electron、Tailwind4、TS 双 tsconfig）、frameless 主窗口 + IPC 窗口控制、dev/build 脚本跑通。
- 验收：`npm run electron:dev` 起空白壳窗口，`npm run build` + typecheck 通过。

### M1 — 服务层移植（纯逻辑，无 UI 依赖）✅
- models.ts、http 工具、gdstudio/meting/chksz/bilibili 四个 provider、hybrid + musicService（含 4 个搜索 scope、id 前缀分派、`_matchScore`）、appSettings（localStorage）、authService + libraryService（远端同步、乐观更新、mutation 队列）。
- 验收：`node --test` 单测覆盖 hybrid 分派与 match 打分、library 乐观更新；渲染层 console 能搜出真实结果并拿到 playUrl。

### M2 — 播放引擎 ✅
- PlayerContext（单 audio 元素、AbortController 生命周期、error/stalled 12s 看门狗最多重试 2 次、metadata 20s/play 12s 超时、150ms crossfade、>15min 断点记忆）。
- 主进程 session 头注入（B 站域名 Referer）→ B 站直链流播；`imusic-audio://` 特权协议 + Range 服务本地缓存。
- 缓存完整性：下载走 `.part` 临时文件 → 校验 size + 容器头（MP4 `ftyp` / MP3 `ID3`）+ sha256 receipt → 原子替换；命中前复检，损坏重下（防半截文件被当缓存）。
- 下载队列：全局 2 并发上限（防 B 站 412/429 风控）+ 重定向逐跳校验 ≤5 跳 + 绝不带会话 Cookie。
- 验收：GDStudio/ChKSz/B站三类音源点歌即播；B 站首播 < 3s（对比 Flutter 版整首下载）；断网/卡住能自动恢复或报错到 UI；批量收藏歌单不触发风控。

### M3 — UI 主体 ✅
- App 壳（侧栏/主区/播控栏/标题栏）、首页、搜索（4 scope Tab）、收藏、历史、歌单详情、右键/`...` 加入歌单、新建歌单 Modal。
- 验收：与原型站逐屏对比；喜欢/历史/歌单改动实时同步各视图；登录后曲库与服务器一致。

### M4 — 抽屉与设置 ✅
- 播放队列抽屉、歌词抽屉（卡拉 OK 行高亮）、设置页（ChKSz key、缓存目录与清理、账号）。
- 验收：歌词滚动与进度同步；设置改动即时生效。
- 验收结果（2026-10-14，`qa/net-source-probe.mjs` 对真实 Electron 窗口）：netease 源搜索 20 条 → 点击即播（`audio.src=m801.music.126.net`、`readyState=4`、`duration=325.9s`、`error=null`、事件链 loadstart→loadedmetadata→play→loadeddata→canplay→playing）；歌词 71 行，行高亮与进度区间一致（pos 1.0s → 行@1.0s，pos 10s → 行@2.0s，下一行 25.237s；9s 后高亮前进 1 行）。

### 上游回归修复：GDStudio 音源只剩 netease
- 2026-10 上游 `music-api.gdstudio.xyz` 变动：`joox` 的 `types=url` 恒返回空地址（`{"url":"","br":-1}`），`kuwo/tencent/kugou/migu/spotify/deezer` 一律 HTTP 400 `Value of source is not supported`，`meting` 相关路径亦不可用；仅 `netease` 的 search/url/lyric 与封面可用。
- 症状：默认搜索 scope「元数据歌曲」返回 joox 结果，点歌后播控栏有歌名但**不出声**（URL 解析为空）。
- 修复：`electron-app/src/services/gdstudio.ts` 的 `defaultSources` 收敛为 `['netease']`（第一页顺序 + 可翻页源），`parseSongId` 兼容 `gdstudio:netease:{id}` 与旧式 `gdstudio:{id}`，封面地址按源分派；netease 失效时由 Hybrid 的 Bilibili 兜底。
- 同源影响：桌面 Flutter 版 `lib/services/gdstudio_music_client.dart` 已同步收敛为 `['netease']`；但移动端 `D:/project/my-music/lib/services/gdstudio_music_client.dart` 仍是 `['joox','kuwo','netease']` 且封面仍走 `image.joox.com`，未修（症状同：元数据搜索出 joox 结果、点歌不出声）。

### M5 — 打磨与发布（进行中）
- 性能（懒加载封面 / 进度渲染分层）、动效（framer-motion 视图 fade、封面 scale）、electron-builder NSIS 打包、与 Flutter 版功能清单对账。
- 验收：安装包可装可用；功能对账表全绿。

#### M5.1 与 Flutter 功能清单对账

屏级对账（Flutter `lib/desktop/screens` ↔ `electron-app/src/views`）：

| Flutter | electron-app | 状态 |
|---|---|---|
| `desktop_home_screen.dart` | `views/HomeView.tsx` | ✅ |
| `desktop_search_screen.dart`（4 scope） | `views/SearchView.tsx` | ✅ |
| `desktop_library_screen.dart`（4 标签页） | `views/LibraryView.tsx` | ✅ 本轮新增（我喜欢的音乐 / 我的歌单 / 播放历史 / 离线缓存） |
| `desktop_favorites_history_screens.dart` | `views/FavoritesView.tsx` + `views/HistoryView.tsx` | ✅（拆成两个视图） |
| `desktop_playlist_detail_screen.dart` | `views/PlaylistDetailView.tsx` | ✅ |
| `desktop_profile_screen.dart` | `views/ProfileView.tsx` | ✅ 本轮新增（含未登录态） |
| `desktop_focus_screen.dart` | `views/FocusView.tsx` | ✅ 本轮新增 |
| `desktop_settings_screen.dart` | `views/SettingsView.tsx` | ✅ |

部件级对账（Flutter `lib/desktop/widgets`）：

| Flutter | electron-app | 状态 |
|---|---|---|
| `desktop_app_shell.dart` | `App.tsx` + `state/route.tsx`（单壳 in-shell 路由） | ✅ |
| `desktop_sidebar.dart` | `components/Sidebar.tsx` | ✅（本轮补「我的音乐」「我的主页」入口） |
| `desktop_player_bar.dart` | `components/PlayerBar.tsx` | ✅（本轮补专注模式开关） |
| `desktop_right_rail.dart`（歌词/队列两 tab） | `components/LyricsDrawer.tsx` + `QueueDrawer.tsx` | ✅ 等价实现（抽屉式） |
| `desktop_user_avatar.dart` / `desktop_user_login_area.dart` | `Sidebar.tsx` 底部登录态 + `ProfileView.tsx` | ✅ |
| `desktop_empty_states.dart` | 各视图内联空态 | ✅ |
| `desktop_adaptive_content_width.dart` | 主区 `px-8` + `max-w` 内容宽 | ✅ |
| `animated_equalizer_icon.dart` | 播控栏封面 playing 脉冲动画 | ✅ 等价 |
| `desktop_shortcut_controller.dart` + `shortcut_settings.dart` | `services/shortcutSettings.ts` + `state/shortcuts.ts` + `state/shortcutStatus.ts` + `components/SettingsShortcuts.tsx` | ✅（应用内空格/F + 7 条全局热键经 `electron/shortcuts.ts` 主进程注册；设置页可录制改绑/恢复默认） |
| `update_checker_controller.dart` + `update_dialog.dart` + `update_service.dart` | `electron/update.ts` + `electron/zipUpdater.ts` + `state/update.ts` + `components/UpdateDialog.tsx` + 设置页「关于」段 | ✅ 本轮完成（启动静默检查 `desktop-update.json` + 手动检查 + 四态弹窗 + sha256 校验 + 下载地址白名单） |
| `desktop_lyrics_window_controller.dart`（独立歌词窗口） | — | ⏸ 范围外（见 §2 Out of Scope，M5+） |

本轮对账取证（2026-10-14，`qa/parity-probe.mjs` 对真实 Electron 窗口，`pass: true`）：
- 我的音乐：4 个标签页齐备且逐一切换均有对应面板；离线缓存面板拿到主进程真实统计（0 个文件 / 0 B / `C:\Users\admin\AppData\Roaming\imusic-desktop\audio-cache`）。
- 我的主页：未登录态渲染登录入口（`profile-login-entry`）；登录态分支（昵称/@用户名/三指标/创建与收藏歌单）因无测试账号未覆盖。
- 专注模式：大封面 + 歌词窗格存在，netease 源 71 行歌词，活动行 `作曲 : 高橋優`@1s → 6s 后前进到 @2s（高亮随播放推进），容器 `scrollTop` 跟随居中；点「退出专注」回到来源路由（我的音乐）且播放不中断。
- 控制台无 error。（截图：`qa/parity-library.png` / `qa/parity-profile.png` / `qa/parity-focus.png`）

快捷键体系取证（2026-10-14，`qa/shortcuts-probe.mjs` 对真实 Electron 窗口，`pass: true`）：
- 设置页 9 行键位与 Dart 默认值逐条一致（Space / F + `Ctrl+Alt+P/←/→/↑/↓/M/D`），全局热键开关与「恢复默认」齐备。
- 应用内快捷键：CDP 真实按键 `F` → 专注模式；播放中按空格 → 暂停 → 再按 → 继续。
- 改绑链路：点键帽进入录制（`按下新的快捷键`）→ 录制期间屏蔽应用内快捷键（按 `Ctrl+Alt+Shift+F` 不触发专注模式，只写入绑定）→ 落盘 `settings_shortcuts.shortcuts.toggleDesktopLyrics` → 该行占用提示消失。
- 全局热键（真 OS 级，PowerShell SendKeys）：`Ctrl+Alt+Shift+D` → 主进程 `globalShortcut` → 渲染进程 `onShortcut('toggleDesktopLyrics')` → 歌词抽屉开；`恢复默认` 还原为 `Ctrl + Alt + D`。
- ~~⚠️ 环境限制（非代码问题）：本机 `Ctrl+Alt+字母` 被系统/其他程序占用~~ **该结论已推翻（2026-10-14 复核）**：本机没有任何外部程序占用 `Ctrl+Alt+字母`。当时观察到的 7 条失败是「另一个自己」造成的 —— 打包版（userData `%APPDATA%\IMusic`）与开发版（`%APPDATA%\imusic-desktop`）属不同单实例/存储域，可同时运行并争抢同一批全局热键；关掉打包版实例后，开发版单实例启动 9 行键位全部注册成功（0 失败，`qa/cdp-eval.mjs` 读设置页 `[data-shortcut-unavailable]` 为空）。改绑 UI 仍然保留（用户依然可能遇到真实占用）。

更新检查取证（2026-10-14，`qa/update-probe.mjs` 对真实 Electron 窗口 + 本地假发布服务，`pass: true`，8/8）：
- 假 manifest 声明 `9.9.9+7`（真实版本 `2.0.0`）→ 设置页「关于」显示当前版本 `v2.0.0`；点「检查更新」→ 弹窗 `发现新版本 v9.9.9+7`（`data-update-state=available`）。
- 点「立即下载」→ 观察到 `downloading`（进度事件真的在推进，3MB 假包）→ `downloaded`。
- 落盘文件 sha256 与 manifest 一致（`bfe74807…9633c5`），无 `.part` 残留 —— 校验不过不会进入 `downloaded`。
- 全程未触发安装（应用仍在运行、安装按钮未被点击）；`下载中` 点「取消」会同时取消下载并回到 idle。
- 白名单生效：`downloadUrl` 指向 `evil.example.com` 时被拒（`安装包下载域名不在白名单内：evil.example.com`）。

单实例锁取证（2026-10-14）：实例 A 运行中再启动实例 B → B 立即退出（只有 A 的 CDP 端口存活，`electron.exe` 进程数不变），单实例锁生效。

#### M5.3 性能与动效（已完成的部分 + 未做的部分及原因）

已做：
- **进度渲染分层**（本轮真正的性能问题）：`currentTime` / `duration` 原先在主 context 里，而 `timeupdate` 约每 250ms 触发一次 —— 意味着只要在放歌，**所有 `usePlayer()` 消费者（含几百行的收藏/歌单/历史列表）每秒重渲染约 4 次**。现拆出 `PlayerTimeContext` + `usePlayerTime()`（`src/contexts/PlayerContext.tsx`），只有播控栏 / 歌词抽屉 / 专注页订阅进度，列表不再跟着 tick 重渲染。
- **封面懒加载**：`Cover` 加原生 `loading="lazy"` + `decoding="async"`（屏幕外的图不发请求、解码不占主线程），加载完成做一次 300ms 淡入 + 轻微放大（只动 transform/opacity）。同时下发 `data-cover-loaded` 供 QA 断言「没有封面卡在不可见状态」。
- **视图切换动效**：`App.tsx` 改用 framer-motion `AnimatePresence` + `motion.div`（180ms），替代原先的 CSS `@keyframes fadeIn`（已删）。**只动 opacity**：带 transform 的祖先会给内部 `position: fixed` 元素造出包含块，行内右键菜单的全屏遮罩会因此错位。
- 封面微交互：播放中的播控栏封面脉冲（原有）+ 加载 scale-in（本轮）。

未做（有意不做的部分）：
- **JS 虚拟滚动**：`content-visibility: auto` 会带来 layout/paint containment，而 `SongTable` 的行内就渲染着 `fixed inset-0` 的菜单遮罩（会被裁剪/改基准）；且当前列表规模有界（搜索每页 20 条 + load-more，收藏/歌单是用户自己的量级）。若日后歌单规模变大，正确做法是先把遮罩提到表格层渲染（行内不再有 fixed 元素）+ 再上虚拟化。

取证（2026-10-14，真实 Electron 窗口，改完 `usePlayerTime` 分层后重跑）：
- `qa/net-source-probe.mjs` → `pass: true`（6/6）：netease 直链 `m801.music.126.net`、`readyState 4`、`duration 238.7s`、`error null`，且 `lyricsSynced` / `lyricsAdvanced` 均 true —— 这两项正是靠 `usePlayerTime()` 驱动的进度↔歌词同步，说明拆分没有破坏同步。
- `qa/parity-probe.mjs` → `pass: true`（屏级 8/8 仍齐平）。
- 封面状态：首页 11 张封面全部 `data-cover-loaded="true"`（0 张卡在不可见、0 张退化占位）——淡入动画不会把封面留在透明态。

对账结论：**屏级 8/8 齐平**；部件级「独立歌词窗口」已在 M6 补上。

### M6 — 用户反馈修复轮（2026-10-15，六项）

用户验收后提了 6 项，全部落地：

| # | 反馈 | 根因与修复 |
|---|---|---|
| 1 | 独立桌面歌词窗口 | 新增 Electron 第二 BrowserWindow：`electron/lyricsWindow.ts`（透明/置顶/不进任务栏/可拖动），同一 bundle 按 `#/lyrics-window` 分流（main.tsx），播放状态经主进程 IPC 转发（`DesktopLyricsBridge`，500ms 节流 + 换歌/歌词/播放态立即发），窗口内控制按钮回发命令执行。Ctrl+Alt+D 热键从「歌词抽屉」纠正映射为独立窗（与 Dart 端一致），播控栏新增桌面歌词按钮（MonitorSmartphone）。`qa/lyrics-window-probe.mjs` 验证：真实歌词行同步 + 下一行预览 + 暂停/继续双向控制 pass |
| 2 | 登录账号后同步功能 | **真 bug**：`runtime.ts` 装配时没把 `onLibraryFromLogin` / `onAccountLibraryCleared` 回调传给 AuthService —— 登录响应里的云端音乐库被丢弃，UI 却提示「已同步」。修复：惰性引用接线（登录即灌库）、登录/注册后兜底 `loadLibrary()` 并显示真实同步数量、启动时仅已登录才拉云端库（消除未登录 401 告警）。取证：用户 linyan 账号云端 ↔ 本地一致（1 收藏 / 0 歌单），点喜欢→云端 PUT→取消喜欢的写回路全通。`tests/auth-library-sync.test.ts` 7 个测试锁定 |
| 3 | 配置 ChKSz key 后搜索没打通 | **两个真 bug**：(a) `createMusicService` 在启动时快照 key，设置页填 key 后必须重启才生效 —— 改 `createChkszResolver`（每次取用按当前 key 解析，key 变即换实例，对齐 Dart Riverpod 重建）；(b) `163_music` 对无 exhigh 音质的歌返回 `code 404 Music URL not found`，原先被当成系统性错误直接上抛、放弃整条音质阶梯 —— 新增 `isQualityLevelMiss` 分类，降档 standard 继续试。另外设置页新增「测试连接」「清除」按钮（`verifyChkszKey` 打一次真实 163_search 回报可读结果），搜索页 key 缺失提示加「去设置填写密钥」跳转。取证：不重启清空 key→ChKSz tab 报未配置→填 key 保存→立即搜出 20 条→播放出声（87 行歌词）。`tests/chksz-playurl.test.ts` 8 个测试锁定 |
| 4 | 首页没打通，下方没有歌词或歌曲封面 | 三个问题：(a) 首页「最近播放」错展示推荐结果 —— 改用真实播放历史；(b) 热门歌单点进去永远「歌单不存在」—— PlaylistDetailView 只查本地库，不会按 id 取远端合集，补 `getPlaylist` 远端解析（对应 Dart `musicService.getPlaylist`）；(c) **根因最深的 bug**：B 站 playurl 返回 3 个候选（PCDN mcdn:8082 / PCDN 镜像域名:4483 / 标准 CDN upos），旧代码只排除字面量 `mcdn.bilivideo`，把第二类 PCDN 镜像当普通 CDN 优先选中 —— 本机系统代理下 :4483 连不通 → readyState 恒 0 → 「播放失败（已重试 2 次）」。新增 `pickBestMediaUrl`（标准 CDN > 其他非 PCDN > PCDN，判定含 os=mcdn 与 4483/8082 端口）。另外补齐 Dart 首页对齐的「继续播放卡」（大封面 + 当前歌词行）与「热门歌单」分区 + 加载更多。`tests/bilibili-media-url.test.ts` 8 个测试锁定（用真实 API 候选做样本） |
| 5 | 对照 BiliMusic 优势继续优化 | 补 `navigator.mediaSession`（SMTC）：Windows 系统音量浮层/媒体键显示封面、标题、歌手，系统层播放/暂停/上下首/seek 直接控制应用（`MediaSessionBridge`）。此前已借鉴的 5 项（Referer 注入直链、缓存完整性、下载并发、stalled 看门狗、crossfade+断点记忆）已在 M1-M5 落地 |
| 6 | UI 更美观 | (a) 列表「正在播放」行改为跳动音柱（`PlayingIndicator`，复用 eq 动画、相位错开），悬停变暂停 —— Apple Music 行为；(b) 封面占位从统一死灰改为按标题哈希取色的柔和渐变（`Cover` 的 `seed` 属性，同一标题永远同色）；(c) 首页封面卡带「播放中」徽标 |

回归取证（真实窗口）：net-source-probe 6/6 pass（netease 直链 + 歌词同步）、parity-probe 屏级 8/8 pass、chksz-probe 7/7 pass、lyrics-window-probe pass、单测 **64/64**（新增 15 个）。

### M6.1 — 用户验收回归修复（2026-10-15）

| # | 反馈 | 根因与修复 |
|---|---|---|
| 1 | 热门歌单/推荐歌曲/最近播放没有封面 | **M6 自己引入的回归**：首页卡片用 `size={0}` + `className="!h-auto aspect-square w-full"`（靠 class 填满网格单元），而 M6 的 Cover 重写无条件写内联 `style={{width:size,height:size}}`，内联优先级高于 class → 封面被压成 **0×0**（图片其实已加载，`naturalWidth>0`）。修复：抽出 `coverStyle(size, placeholder)`，`size<=0` 时不下发内联尺寸。验证方式也随之纠正：不能只看 `data-cover-loaded`（它只反映图片是否加载，0×0 时照样 true），必须量 `getBoundingClientRect`。`tests/cover-size.test.ts` 4 个测试锁定。取证：修复前 32 张里 30 张 0×0 → 修复后 31/31 均 178×178（开发版与打包版均验）。 |
| 2 | 独立桌面歌词窗口怎么打开（找不到入口） | 功能已在 M6 做完，但入口隐蔽。补设置页「桌面歌词」分区（打开/关闭按钮 + 当前状态 + 热键提示）。现有三个入口：播控栏右侧「桌面歌词」按钮（MonitorSmartphone 图标）、全局热键 **Ctrl+Alt+D**、设置页按钮。取证（打包版）：设置页点击后 label 翻转、`lyricsIsOpen()=true`、出现第二个 `#/lyrics-window` 页面目标。 |

交付：`electron-app/release-build2/IMusic-Setup-2.1.1-x64.exe`（版本 2.1.1）。单测 68/68。

### M7 — 用户验收回归修复第二轮（2026-10-15，六项）

| # | 反馈 | 根因与修复 |
|---|---|---|
| 1 | 热门歌单「加载更多」无限追加，把推荐歌曲/我喜欢的音乐越推越远 | 改为**分页**（上一页/下一页 + 第 N 页），`getHotPlaylists({limit,offset})` 按页替换内容，grid 恒 10 张，下方分区永不被顶。 |
| 2 | 热门歌单与推荐歌曲「几乎一样，都是歌单形式」；参考 BiliMusic 怎么做 | BiliMusic 的推荐/发现页是**单曲 feed**（多源混合：B站推荐流、音乐区排行、新歌速递、音乐动态、相关视频，mixMusicPools 交错去重 + 换一批换 seed），歌单是独立页。对齐实现：(a) `bilibili.getMusicRanking`（B站音乐区三日热榜 rid=3，客户端分页，过滤合集保证单曲）；(b) `getRecommendedSongs(page)` = 热榜单曲池（可直接播）+ Gateway 单曲池交错混合；(c) 推荐歌曲加**「换一批」**按钮（整体替换不追加）。 |
| 3 | 桌面歌词窗口「几乎没功能，只显示歌词」；要求对照之前的设计重构 | 对照 Flutter `lib/lyrics_window/lyrics_window_app.dart` 重构：全透明浮字（无药丸底，文字阴影保证可读）、悬停工具条（**喜欢/上一首/播放暂停/下一首/锁定位置/关闭**）、**锁定后禁止拖动**（-webkit-app-region 切 no-drag）、**设置页字号/颜色即时同步**（payload 增加 fontSize/colorValue）、收藏态双向同步（`toggleFavorite` 命令）、换行 160ms 过渡、暂无歌词兜底。探针 `qa/lyrics-window-features.mjs` 全验。 |
| 4 | 歌单只能创建不能删除 | `library.deletePlaylist` 服务早就有（乐观更新 + 远端同步），纯缺 UI。补两处：Sidebar 歌单行悬停垃圾桶、歌单详情页头部「删除歌单」（均带原生 confirm 确认）。`qa/playlist-delete-probe.mjs` 验证建→确认→删全链路。 |
| 5 | 点左下角封面应进专注模式，再点退出 | PlayerBar 封面包成按钮，`data-testid="cover-focus-toggle"`，点击 `route.toggleFocus()`；空播放态禁用。 |
| 6 | 进度条 hover 变粗导致上方按钮上移 | Slider 轨道高度从 3px↔6px 参与布局改为**恒定 3px + `scale-y-[2]` transform 视觉放大**（transform 不影响布局），按钮位置 hover 前后位移 0px。 |

交付：`electron-app/release-build3/IMusic-Setup-2.2.0-x64.exe`（版本 2.2.0，打包版冒烟：全分区 + 分页 + 换一批 + 34 张封面全有尺寸）。单测 68/68。

#### M7.1 — 验证时又抳出的两个真 bug（同轮修复）

| bug | 现象 | 根因与修复 |
|---|---|---|
| 已收藏不被识别 | 心形按钮不亮（主窗口与歌词窗都是），点一下反而把已收藏的歌取消掉 | 收藏后库里的 B 站分P歌 id 会带 `:pN` 后缀（`bilibili:BV...:p1`），当前播放曲 id 是 `bilibili:BV...`；UI 四处用严格 `s.id === song.id` 判定（PlayerBar / DesktopLyricsBridge / SongTable / SearchView），而库内部用的是 `songsShareIdentity` 身份比较 —— **收藏其实已正确写入云端**，只是 UI 不认。新增 `LibraryService.isLiked(song)`（身份比较）并四处改用。`tests/library-liked.test.ts` 5 个测试锁定。 |
| B站 http 封面被 CSP 拒载 | 部分封面空（占位渐变），控制台刷 `Refused to load the image 'http://i2.hdslb.com/...' because it violates CSP img-src` | `index.html` 的 CSP `img-src` 只有 `https:`，而部分音源/图床接口回的是 `http://` 直链。修复：`img-src` 加 `http:`（`connect-src` 早已允许 http），并新增 `normalizeBilibiliImageUrl` 把 B站图的 `//` 与 `http://` 统一升到 `https://`。 |

交付：`electron-app/release-build5/IMusic-Setup-2.2.2-x64.exe`（版本 2.2.2）。单测 **73/73**。打包版复验：推荐歌曲 = 10 首真单曲（大海/张雨生…）、分页 2 个按钮、换一批在、进度条 hover 按钮位移 0px、封面 0 空、歌词窗 6 个工具按钮 + 锁定切 no-drag + 字号 26px/权重 800/有阴影、sidebar 删除按钮在。

### M8 — 热门歌单换一批 + 前进/后退导航（2026-10-15）

| # | 需求 | 实现 |
|---|---|---|
| 1 | 热门歌单也做成换一批 | 撤掉上一页/下一页分页，改为与推荐歌曲一致的「换一批」按钮（RefreshCw + 旋转态）。为让每批真正不同，服务端按批次**轮换搜索主题**（`hotPlaylistQueryForBatch`：10 个主题池「音乐合集/歌单精选/华语经典/抖音热歌/车载音乐/欧美精选/纯音乐/粤语经典/摇滚精选/影视原声」，主题内部再翻页）。`tests/hot-playlists.test.ts` 锁定轮换语义。 |
| 2 | 前进/后退功能（UI 设计自定） | (a) **历史核** `src/state/history.ts`：纯函数 navigateTo/goBack/goForward/replaceCurrent，浏览器语义（新导航清前进栈、相同目标不入栈），专注模式不进历史；(b) **UI**：主内容区顶部吸顶浮条（`bg-white/75 backdrop-blur-xl`，与播控栏同套视觉），Spotify 风格一对 28px 圆形 chevron，无历史方向置灰禁用；(c) **三个入口**：按钮点击 / 键盘 Alt+←→（输入框聚焦时不抢键）/ 鼠标侧键（主进程 `app-command` browser-backward/forward → IPC）；(d) 在专注模式里按后退 = 退出专注回来源。`tests/history.test.ts` 7 个测试锁定。 |

交付：`electron-app/release-build6/IMusic-Setup-2.3.0-x64.exe`（版本 2.3.0）。单测 **83/83**。打包版复验：导航浮条吸顶 + 后退回首页、热门歌单换一批按钮在、封面 0 空。

### M8.1 — 导航位置对齐 Flutter + 「今日精选」概念重定义（2026-10-15）

| # | 反馈 | 实现 |
|---|---|---|
| 1 | 前进/后退放的位置不合适，参考 Flutter 版位置 | Flutter `_TopDragBar`：后退/前进在**标题栏**内，`left = 侧栏宽(240) + 12 = 252px`（主内容区左缘正上方），30px 圆形按钮。Electron 端对齐：撤掉 M8 主内容区顶部的吸顶浮条，`NavHistoryControls` 移入 TitleBar 绝对定位 `left-[252px]`（按钮 no-drag）。键盘 Alt+←→ 与鼠标侧键入口不变。实测坐标 (252, 5)，在 38px 标题栏内。 |
| 2 | 「精选歌单是按什么逻辑？一次就那两个吗？何为精选？」 | 诚实回答：**之前没有逻辑** —— 只是 `recommended.slice(0, 2)`（推荐 feed 的前两条单曲），与「推荐歌曲」区内容重复，卡片还挂着名不副实的「FEATURED PLAYLIST」标签。重定义为**「今日精选」**：以日期为种子的主题精选**歌单**（`dailyFeatured`：UTC 天数 % 10 → 热门歌单主题池批次前 2 个合集），当天固定、次日换主题；大卡位显示「今日精选」标签 + 分区副标题「主题 · ×××」；点击进合集详情，hover 播放键取曲目整单播放。与「热门歌单」（手动换一批的浏览网格）、「推荐歌曲」（单曲 feed）三者职责彻底分开。`tests/featured.test.ts` 4 个测试锁定（同天不变/跨天换主题/10 天 10 主题/batch 不为负）。 |

交付：`electron-app/release-build7/IMusic-Setup-2.3.1-x64.exe`（版本 2.3.1）。单测 **87/87**。打包版复验：导航 (252,5)、精选 2 大卡带主题、后退回首页。

### M8.2 — 导航位置再调 + 头像打通/上传 + 播控栏定宽（2026-10-15）

| # | 反馈 | 实现 |
|---|---|---|
| 1 | 前进/后退位置再改：顶在侧栏右沿 | TitleBar 内从 `left-[252px]`（主内容区左缘）改为侧栏区（240px）内**右对齐**（pr-3），实测右缘 x=228。 |
| 2 | 用户头像没打通 | 后端 /me 本来就返回 avatarUrl（相对路径 /uploads/avatars/...，该账号在移动端已设过头像），UI 却只渲染字母。新增共享 `UserAvatar` 组件（有图显图、破图回退字母），接入首页头部 36px / 侧栏 20px / 个人页 104px / 设置页 44px 四处。 |
| 3 | 头像编辑上传功能没有 | 移植移动端 API：`AuthService.uploadAvatar`（PUT /me/avatar { mimeType, imageBase64 }，成功后用返回 user 刷新全局状态）。设置页头像点击更换：隐藏 file input → createImageBitmap 居中裁方缩到 256px JPEG（canvas 编码，上传体 ~15KB）→ 上传 → 全端即时刷新。hover 相机遮罩 + 上传中转圈 + 结果消息。 |
| 4 | 左下角封面/曲名区域长度应固定控制，长标题把红心顶右 | 曲名/歌手文本块加 `max-w-[240px]`：长标题在 240px 处截断，红心位置不再随曲名漂移（短标题仍紧凑跟随）。实测超长标题《海阔天空…》截到正好 240px。 |

验证：头像上传端到端（DOM.setFileInputFiles 驱动真实文件选择 → 上传 → /me 新 URL → UI 刷新），测试后已把原头像传回恢复。`tests/avatar.test.ts` 4 个测试（URL 解析三种形态 / 上传请求形状与状态刷新 / 未登录 401 不发请求）。

交付：`electron-app/release-build8/IMusic-Setup-2.3.2-x64.exe`（版本 2.3.2）。单测 **91/91**。

#### M5.2 回归测试（补上 electron-app 的空白）

`electron-app` 原先没有任何测试（`npm test` 指向不存在的 `tests/` 目录，退出码 2），而 Flutter 侧有 242 个测试。现已补上 **35 个** 测试 / 6 个文件，`npm test` 可用（`node tests/run.mjs`：先用 esbuild 把 `tests/*.test.ts` 打成 CJS，再交给 `node --test` —— 源码是无扩展名相对导入的 TS，必须过一遍打包器）。

每个文件都锁死一个本轮重构中**真出现过**的回归：

| 测试文件 | 锁定的回归 |
|---|---|
| `tests/bilibili.test.ts` | B 站搜索混入无 bvid 条目（`type=ketang` 课堂/番剧/影视）→ 修复前生成空 id `bilibili:`、取 CID 失败（「有歌名不出声」）；含 `getPlayUrl` fail-fast 与空查询不发请求 |
| `tests/musicService.test.ts` | 空载荷 id（`bilibili:` / `gdstudio::`）从推荐/热点歌单等出口流入 UI；scope 分派（All / MetadataSongs 回落 / BilibiliPlaylists 空 / ChkszSongs 未配置时报错） |
| `tests/gdstudio.test.ts` | 默认源被「照抄」回 `['joox','kuwo','netease']` 导致取链为空（上游只剩 netease）；`parseSongId` 只接受 `gdstudio:{source}:{id}`（与 Dart 端一致） |
| `tests/shortcuts.test.ts` | `globalAccelerators()` 把 `scope:'inApp'` 的 Space / F 也注册成系统级热键（运行期间从系统抢走空格）；默认 7 条全局热键与 Dart 默认值一致 |
| `tests/lyrics.test.ts` | LRC 解析（多时间戳、厘秒补齐、元信息、翻译行并入）与 `activeLyricIndex` 的 0.1s 容差 |
| `tests/update-version.test.ts` | 版本比较按 pub_semver 语义（**build metadata 参与比较**，`2.0.0+22` vs `2.0.0+23`）；无法解析的版本视为「无更新」 |

此外顺手修掉两处本轮发现的隐患：
- 两份 `parseSongId` / `searchSongs` 上方的旧注释还写着 「Page 1: joox → kuwo → …」——正是这个注释使 TS 移植时照抄了旧源顺序、撞上上游回归；Dart 与 TS 两侧都已改写为 netease-only + 回归说明。
- `package.json` 重复了 `description` 键（后者静默覆盖前者），已去掉重复。

`electron-app/.gitignore` 已补上（原先只有仓库根 `.gitignore`，而根里 `/dist/`、`/build/` 是锚定根目录的，`electron-app/dist`、`release` 等不会被忽略）；QA 报告 JSON 与截图作为取证保留入库，日志/pid 不入库。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| B 站接口风控（412/429） | 请求合并、指数退避、并发上限 2（沿用 BiliMusic 经验） |
| ChKSz/Meting 接口变动 | provider 层隔离，单测锁定响应解析 |
| 服务端曲库 API 与 Flutter 版耦合 | 移植时以 `library_service.dart` 实际请求为准写契约测试 |
| 原型为浅色单主题 | 设计 token 集中 `src/styles/tokens.css`，后续可扩暗色 |
| 打包产物的 `app.asar` 在**运行过**打包版之后会被持续占用（`EBUSY: resource busy or locked, unlink ...resources/app.asar`），electron-builder 无法重新写同一个输出目录 | 换个输出目录重建（`npm run electron:build -- -c.directories.output=release-build`）或重启后再删旧目录；已运行的旧 `win-unpacked` 可不用管（已被 `.gitignore` 的 `release*/` 盖住）。本次即用此法重建并把安装包放回惯例路径 `release/` |
| 开发版与打包版是两套 userData（`%APPDATA%\imusic-desktop` vs `%APPDATA%\IMusic`） | 两者可同时运行并争抢同一批全局热键（表现为设置页报「组合已被占用」），验证打包版前先退出开发版实例 |
| 未登录时启动拉取曲库返回 401 | 已有容忍（控制台告警、不阻断启动）；登录后正常同步 |

## 6. 参考

- 原型：https://frosted-play-room.lovable.app
- UI 提示词：`C:\Users\admin\Downloads\gemini-code-1791982689272.md`
- 技术栈参考：https://github.com/Withnoidea/BiliMusic
- 现有 Flutter 实现：`lib/desktop`、`lib/services`、`lib/playback`
- 技术文档：`docs/electron-rewrite-technical-design.md`
