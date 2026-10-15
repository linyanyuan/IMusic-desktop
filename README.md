# IMusic Desktop

IMusic Desktop 是一款桌面端音乐播放器，面向桌面场景重新设计了听歌、搜索、歌单管理、歌词展示和账号曲库同步体验。

它不是简单把移动端界面放大，而是采用更适合电脑使用的工作台布局：左侧常驻导航、中间主工作区、右侧播放上下文、底部稳定播放栏。用户可以一边搜索音乐和歌单，一边查看队列、歌词、收藏状态和播放信息。

> **仓库里有两套前端，发布渠道互相独立，不要混用：**
>
> | 前端 | 目录 | 面向 | 发布方式 |
> | --- | --- | --- | --- |
> | Flutter 桌面版 | `lib/` `windows/` | 老用户（当前线上版本） | PowerShell 脚本 → 自建服务器 `60.205.218.90:8787` |
> | Electron 重构版 | `electron-app/` | 后续主力版本 | 打 git tag → GitHub Actions → GitHub Releases |
>
> 两边的更新器各读各的 manifest，互不感知。给其中一边发版本**不会**让另一边用户收到更新。
> 想发哪一版，就看对应那一节的说明。

## 目录

**日常使用**

- [功能亮点](#功能亮点)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [本地运行](#本地运行)

**发布新版本**（[版本发布与软件内更新](#版本发布与软件内更新) 开头有两套前端的对照表，先看那个再动手）

- [A. 发布 Flutter 桌面版](#a-发布-flutter-桌面版老用户) —— 老用户在用的版本，发自建服务器
  - [A0. 一次性服务器配置](#a0-一次性服务器配置)
  - [A1. 确认新版本号](#a1-确认新版本号)
  - [A2. 打包新版本](#a2-打包新版本)
  - [A3. 上传服务器](#a3-上传服务器)
  - [A4. 测试软件内更新](#a4-测试软件内更新)
  - [A5. 重要限制](#a5-重要限制)
  - [A6. 常见问题](#a6-常见问题)
- [B. 发布 Electron 重构版](#b-发布-electron-重构版后续主力版本) —— 后续主力版本，发 GitHub Releases
  - [B0. 前提条件](#b0-前提条件)
  - [B1. 改版本号](#b1-改版本号)
  - [**B2. 一键发布（推荐）**](#b2-一键发布推荐) ← **平时发版就用这一条命令**
  - [B3. 手动发布（不用脚本时）](#b3-手动发布不用脚本时)
  - [B4. 发布后 GitHub Actions 自动完成](#b4-发布后-github-actions-自动完成)
  - [B5. 验证发布结果](#b5-验证发布结果)
  - [B6. 版本号与 build 号（最容易踩的坑）](#b6-版本号与-build-号最容易踩的坑)
  - [B7. 代码签名（可选）](#b7-代码签名可选)
  - [B8. 常见问题](#b8-常见问题)

**其他**

- [开发说明](#开发说明)
- [相关文档](#相关文档)

> **想发新版？** 直接跳到 [B2 一键发布](#b2-一键发布推荐)，一条命令搞定。
> 不确定会发什么，先加 `-WhatIf` 预演一遍。

## 功能亮点

- 桌面端工作台布局：侧边栏导航、中央内容区、右侧上下文栏、底部播放控制栏。
- 歌曲和歌单搜索：支持来源标签、歌单详情、播放全部和收藏歌单。
- 播放控制：上一首、播放/暂停、下一首、播放模式、进度拖动、音量浮层。
- 账号体系：支持登录、注册、退出登录和账号曲库同步。
- 我的音乐：我喜欢的音乐、历史播放、自建歌单、收藏歌单。
- 歌单管理：创建歌单、删除歌单、单首删除、批量删除歌曲。
- 跨端播放兼容：收藏歌曲和歌单时保存移动端可用的播放元数据。
- 歌词体验：歌词加载、超时降级、专注模式歌词、桌面独立歌词窗口。
- 桌面歌词窗口：透明独立窗口、置顶显示、可拖动、可锁定、悬浮工具条、小心心收藏。
- 设置能力：缓存目录、歌词字号、歌词颜色等个性化配置。

## 技术栈

**Flutter 桌面版**：Flutter Desktop / Dart / Riverpod / audioplayers / Dio / shared_preferences / window_manager / desktop_multi_window

**Electron 重构版**：Electron 36 / React 19 / TypeScript / Tailwind CSS 4 / Vite 6 / esbuild

## 项目结构

```text
lib/                 Flutter 桌面版源码
  app/                应用入口、主题和整体配置
  core/               核心模型和通用状态
  desktop/            桌面端页面、壳层、侧边栏、播放栏和组件
  lyrics_window/      独立桌面歌词窗口
  playback/           播放状态和播放动作
  services/           登录、曲库、音乐源和网络服务
  shared/             歌词解析等共享工具
test/                Flutter 回归测试和组件测试
windows/             Windows 桌面端工程配置（Flutter）

electron-app/        Electron 重构版（独立 npm 工程）
  electron/            主进程：缓存/协议/下载队列/歌词窗/快捷键/更新
  src/services/        业务逻辑（从 lib/services 1:1 移植）
  src/state/ src/views/ src/components/   渲染层
  tests/               单元测试（esbuild + node --test）
  qa/                  CDP 取证探针

scripts/             Flutter 版打包与发布脚本；release_electron.ps1 为 Electron 一键发布
doc/                 产品需求和技术设计文档
docs/                技术设计与发布文档
.github/workflows/   Electron 版自动打包发布
```

## 本地运行

Flutter 桌面版（需先安装 Flutter 并启用 Windows 桌面端支持）：

```bash
flutter pub get
flutter run -d windows
```

Electron 重构版：

```bash
cd electron-app
npm ci
npm run electron:dev
```

运行测试：

```bash
flutter test                    # Flutter 版
cd electron-app && npm test     # Electron 版（108 个用例）
```

静态分析 / 类型检查：

```bash
dart analyze                              # Flutter 版
cd electron-app && npm run typecheck      # Electron 版
```

## 版本发布与软件内更新

下面分两节，**按你要发的前端选对应那一节**。两边的 manifest、产物命名、发布渠道都不同。

| | Flutter 桌面版 | Electron 重构版 |
| --- | --- | --- |
| 发版命令 | `package_windows.ps1` | `git push origin v<version>` |
| 产物 | `imusic-<v>-windows-x64.zip` | `IMusic-Setup-<v>-x64.exe` + `IMusic-<v>-x64.zip` |
| 发布位置 | 自建服务器 `60.205.218.90:8787` | GitHub Releases |
| 用户更新来源 | `60.205.218.90:8787/desktop-releases/` | `github.com/linyanyuan/IMusic-desktop/releases/latest/` |
| 自动化 | 手动跑脚本 + scp | GitHub Actions 全自动 |

---

## A. 发布 Flutter 桌面版（老用户）

Flutter 桌面版内置更新读取服务器上的：

```text
http://60.205.218.90:8787/desktop-releases/desktop-update.json
```

服务器目录对应为：

```text
/opt/imusic-desktop/releases
```

不要放到移动端后端目录 `/opt/imusic/server/releases`，那里用于移动端 APK 等发布文件。

### A0. 一次性服务器配置

桌面端和移动端发布目录要分开：

```text
移动端：/opt/imusic/server/releases       -> /downloads 和 /api/app/latest
桌面端：/opt/imusic-desktop/releases     -> /desktop-releases
```

服务器上的 `imusic-api` Node 服务需要把桌面端目录公开成 `/desktop-releases`。配置完成后，下面两个地址必须能返回内容：

```bash
curl -i http://127.0.0.1:8787/desktop-releases/desktop-update.json
curl -i http://60.205.218.90:8787/desktop-releases/desktop-update.json
```

如果返回 `404 {"error":"Not found"}`，说明文件可能已经上传了，但后端还没有映射 `/desktop-releases`。

### A1. 确认新版本号

每次正式发布都要递增版本号：

```text
1.0.1+2
1.0.2+3
1.1.0+4
```

脚本里分开填写：

```powershell
-Version 1.0.2 -BuildNumber 3
```

注意：软件内更新主要比较 `Version`。如果旧版是 `1.0.1+1`，只发布 `1.0.1+2` 不会触发更新；应发布 `1.0.2+3` 或更高版本。

### A2. 打包新版本

普通发布用 zip 绿色包即可，不需要提前准备安装器：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package_windows.ps1 -Version 1.0.2 -BuildNumber 3 -Changelog "修复若干问题，优化更新体验"
```

执行后会生成：

```text
dist\imusic-1.0.2+3-windows-x64\
dist\imusic-1.0.2+3-windows-x64.zip
dist\releases\imusic-1.0.2+3-windows-x64.zip
dist\releases\desktop-update.json
dist\releases\update-manifest-1.0.2.json
dist\releases\UPLOAD_TO_SERVER.txt
```

### A3. 上传服务器

把 `dist\releases\` 里的文件上传到服务器发布目录：

```powershell
ssh root@60.205.218.90 "mkdir -p /opt/imusic-desktop/releases"
scp .\dist\releases\* root@60.205.218.90:/opt/imusic-desktop/releases/
```

也可以使用发布脚本，上传后会自动验证 manifest：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish_releases.ps1
```

上传后检查 manifest 是否能访问：

```powershell
Invoke-WebRequest http://60.205.218.90:8787/desktop-releases/desktop-update.json
```

返回内容里应包含新版本号、下载地址和 `sha256`。

同时确认 manifest 里的 zip 下载地址也能访问，例如：

```text
http://60.205.218.90:8787/desktop-releases/imusic-1.0.2%2B3-windows-x64.zip
```

### A4. 测试软件内更新

1. 运行低于服务器版本的客户端，例如本地旧版是 `1.0.1+2`，服务器发布 `1.0.2`。
2. 打开软件设置里的检查更新，或重启软件等待自动检查。
3. 看到新版本弹窗后点击下载。
4. 下载完成后点击立即更新并退出。
5. 软件会退出、覆盖当前目录、再自动打开新版本。

### A5. 重要限制

- 默认产物是绿色 ZIP 包，不是安装器；它不会写入开始菜单、注册表或桌面快捷方式。需要桌面快捷方式时，请用 Inno Setup、NSIS 等工具单独制作安装器，再通过 `-InstallerPath` 发布。
- zip 更新要求当前客户端已经包含 zip 更新能力；非常早的旧客户端只支持 `.exe/.msi` 安装器更新。
- 如果要发布安装器，可以先用 Inno Setup、NSIS 等工具生成 `.exe/.msi`，再给脚本传 `-InstallerPath`。
- 更完整的命令和常见报错见 `scripts/package_windows_usage.md`。

### A6. 常见问题

- 文件已上传但公网验证 404：检查 Node 服务是否把 `/desktop-releases` 映射到了 `/opt/imusic-desktop/releases`。
- 软件提示已经是最新版本：确认打开的是旧版本客户端，且新版本的 `Version` 大于旧版本。
- 下载失败：先在浏览器打开 `desktop-update.json` 里的 `downloadUrl`，确认 zip 能直接下载。
- 更新后无法覆盖：确认当前客户端目录没有被杀毒软件或其他进程锁住。

---

## B. 发布 Electron 重构版（后续主力版本）

Electron 版用户的应用内更新读取：

```text
https://github.com/linyanyuan/IMusic-desktop/releases/latest/download/desktop-update.json
```

发布靠 **打 git tag 触发 GitHub Actions**，不需要手动上传文件、不需要算 sha256。

### B0. 前提条件

- 改动已 `git push` 到远端（workflow 只会构建远端代码）。
- 本地已装 Node 20+，`electron-app/node_modules` 已装（`npm ci`）。
- **两个渠道互不相通**：Flutter 老用户不会收到 Electron 版更新，需要引导他们手动去 GitHub 下载。

### B1. 改版本号

版本号规则：`主.次.修订[+build号]`。build 号可选，用来区分同版本号的多次构建
（例如 `2.3.3+7`）。**tag 去掉 `v` 之后必须和这个字符串完全一致**，否则 workflow
第一步就会失败。

### B2. 一键发布（推荐）

一条命令完成「改版本号 → 自检 → 提交推送 → 打 tag」：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\release_electron.ps1 -Version 2.3.3 -Changelog "修复若干问题"
```

脚本会依次做：

1. 校验版本号格式、必须大于当前版本、工作区干净、分支与远端同步
2. 写入 `electron-app/package.json` 的新版本号
3. 跑 `npm run release:check`（类型检查 + 108 个单元测试）——**失败就中止，不会发出版本**
4. `git commit` + `git push`
5. `git tag v2.3.3` + `git push origin v2.3.3` ← 这一步触发 GitHub Actions

常用参数：

| 参数 | 用途 |
| --- | --- |
| `-Version 2.3.3` | 必填，新版本号 |
| `-Changelog "..."` | 写进 commit message，方便回溯 |
| `-WhatIf` | **预演**：只打印每步做什么，不改文件不推送 |
| `-SkipTests` | 跳过自检（仅代码无变化时用） |
| `-NoPush` | 只做到本地 tag，不推送 |
| `-Force` | 允许重发同版本号（会删重建远端 tag） |

不确定时先预演一次：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\release_electron.ps1 -Version 2.3.3 -WhatIf
```

### B3. 手动发布（不用脚本时）

```bash
cd electron-app
$EDITOR package.json          # 改 "version": "2.3.3"
npm run release:check         # 类型检查 + 108 个测试
git add package.json && git commit -m "chore(electron): bump 2.3.3" && git push
git tag v2.3.3 && git push origin v2.3.3
```

### B4. 发布后 GitHub Actions 自动完成

1. 校验 tag 与 `package.json` 的 version 一致
2. `npm ci` → 类型检查 → 108 个测试
3. Vite 构建（渲染层 + 主进程 + preload）
4. `electron-builder` 打出 NSIS 安装包 + 绿色 zip
5. 生成 `desktop-update.json`（含 sha256）、`SHA256SUMS.txt`
6. 建 GitHub Release 并上传全部资产

在 <https://github.com/linyanyuan/IMusic-desktop/actions> 看进度。

### B5. 验证发布结果

```bash
# manifest 能访问（把 v2.3.3 换成你的 tag）
curl -s https://github.com/linyanyuan/IMusic-desktop/releases/latest/download/desktop-update.json

# 产物都在
curl -s https://api.github.com/repos/linyanyuan/IMusic-desktop/releases/latest | grep browser_download_url
```

manifest 应含 `version`、`downloadUrl`、`sha256` 三个字段，且 `downloadUrl` 指向
`IMusic-Setup-<完整版本号>-x64.exe`。

### B6. 版本号与 build 号（最容易踩的坑）

- electron-builder 的 `${version}` 宏用**完整**版本号，所以产物叫
  `IMusic-Setup-2.3.3+7-x64.exe`（带 build 号）。
- 更新器 `installerFileName()` 会**去掉** build 号生成 `IMusic-Setup-2.3.3-x64.exe`，
  这个名字只用来给下载回来的文件落地，不用来拼 URL。
- 所以 `downloadUrl` 必须指向含 build 号的那个名，否则 404。
- `version` 字段写完整版本号：更新端按 build 号区分两次构建
  （`2.3.3+8 > 2.3.3+7`），写少了就分不出来。

还有一个相邻的坑：electron-builder 的 zip 在 Windows 上默认叫
`IMusic-<version>-win.zip`（**平台名而不是 arch**）。所以 `build.win.artifactName`
必须显式配成 `${productName}-${version}-${arch}.${ext}`，否则 workflow 按
`-x64.zip` 拼的地址与 sha256 校验会直接报 `No such file or directory`
（2026-10 真实 CI 故障）。workflow 侧同时用 glob 定位产物，不依赖硬编码。

这两条链路分别有 `electron-app/tests/update-publish.test.ts` 和
`electron-app/tests/release-artifacts.test.ts` 锁定，改动前先看它们。

### B7. 代码签名（可选）

当前**没有**签名证书，用户首运会看到 SmartScreen 提示（可点「更多信息 → 仍要运行」）。
接入证书后，在仓库 **Settings → Secrets and variables → Actions** 加：

| Secret | 值 |
| --- | --- |
| `WIN_CSC_LINK` | base64 后的 `.p12` 证书 |
| `WIN_CSC_KEY_PASSWORD` | 证书密码 |

配好即自动签名，无需改代码。

### B8. 常见问题

- **workflow 第一步就红**：tag 和 `package.json` 的 version 不一致。`v2.3.3` ↔ `2.3.3`。
- **提示「找不到 IMusic-Setup-…-x64.exe」**：版本号写法与 tag 不一致，看 B6。
- **发布脚本拒绝执行**：多半是版本号没涨、工作区有未提交改动、或本地分支落后远端。脚本会给出具体原因。
- **`release/` 目录删不掉，报 EBUSY**：跑过打包版之后 `app.asar` 会被持续占用
  （杀进程后仍锁着）。换个输出目录重建，或重启后再清理。
- **想改发布渠道回自建服务器**：设环境变量 `IMUSIC_UPDATE_BASE_URL`，并追加
  `IMUSIC_UPDATE_ALLOWED_HOSTS` 放行域名。
- 更完整的说明见 `docs/electron-release-guide.md`。

---

## 开发说明

- 当前项目主要面向 Windows 桌面端。
- 播放、搜索、登录和曲库同步逻辑集中在 `lib/services/` 与 `lib/playback/`（Flutter）、
  `electron-app/src/services/`（Electron，从前者 1:1 移植）。
- 桌面歌词窗口：Flutter 版用 `desktop_multi_window` 创建独立 Flutter 子窗口；
  Electron 版用主进程 `BrowserWindow` + 特权协议。
- Electron 版的 B 站流媒体走主进程 `session.webRequest` 注入 Referer，本地缓存经
  特权协议提供并支持 HTTP Range。
- 构建产物、日志、IDE 配置、本地调试报告和本地 agent 状态已在 `.gitignore` 中忽略。

### 相关文档

| 文档 | 内容 |
| --- | --- |
| `docs/electron-release-guide.md` | Electron 版发布完整说明（含服务器配置对比） |
| `docs/electron-rewrite-technical-design.md` | Dart → TypeScript 模块映射、流媒体网关、IPC、状态模型 |
| `docs/2026-10-14-electron-ui-rewrite-requirements.md` | Electron UI 重构需求 |
| `scripts/package_windows_usage.md` | Flutter 版打包命令与常见报错 |
