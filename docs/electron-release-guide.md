# IMusic Desktop 打包与发布

桌面端现在有**两套**前端，发布渠道不同：

| 前端 | 目录 | 发布方式 |
| --- | --- | --- |
| Flutter 桌面版 | `lib/` + `windows/` | `scripts/package_windows.ps1` → 自建服务器 `60.205.218.90:8787` |
| Electron 重构版 | `electron-app/` | GitHub Actions → GitHub Releases（本文档） |

本文只讲 **Electron 版**。Flutter 版仍走 `scripts/package_windows.ps1` + `scripts/publish_releases.ps1`，不要混用。

---

## 一、当前分支情况

Electron 重构在 **`feat/electron-ui-rewrite`** 分支上开发，`main` 是 Flutter 版的主干。

```
* feat/electron-ui-rewrite   ← 当前，electron-app/ 全部在这里
  main
```

`electron-app/` 目前**尚未提交**（还是未跟踪目录）。要发 Release 必须先把它提交并推到 GitHub，否则 workflow 里 checkout 出来的是空目录。

```bash
git add electron-app .github
git commit -m "feat(electron): UI 重构 + 代码评审修复 + GitHub Release 流水线"
git push -u origin feat/electron-ui-rewrite
```

> 远端仓库：https://github.com/linyanyuan/IMusic-desktop.git

---

## 二、本地打包

```bash
cd electron-app
npm ci                  # 首次/依赖变动后
npm run release:check   # 类型检查 + 97 个单元测试
npm run electron:build  # 打 NSIS 安装包 + 绿色 zip 到 electron-app/release/
```

产物（`electron-app/release/`）：

| 文件 | 用途 |
| --- | --- |
| `IMusic-Setup-<version>-x64.exe` | NSIS 安装版（可改安装目录、建桌面快捷方式） |
| `IMusic-<version>-x64.zip` | 绿色免安装版（解压即用，应用内更新走 zip 分支） |
| `builder-debug.yml` | electron-builder 调试信息，别上传 |
| `win-unpacked/` | 未打包目录，仅供本地调试，别上传 |

> **已知坑**（项目记忆 #89）：`release*/win-unpacked/resources/app.asar` 在**运行过**打包版之后
> 会被持续占用（杀进程后仍锁着，报 `EBUSY: resource busy or locked`），导致 electron-builder
> 无法重写同一输出目录。规避：换输出目录
> `npm run electron:build -- -c.directories.output=release-build2`，或重启后再清理旧目录。

---

## 三、发布到 GitHub Releases（推荐）

 workflow：`.github/workflows/release-windows.yml`

### 1. 改版本号

```bash
cd electron-app
# 编辑 package.json 的 "version": "2.3.3"
npm run release:check   # 确认测试仍通过
git add package.json && git commit -m "chore(electron): bump 2.3.3"
git push
```

### 2. 打 tag 并推送

```bash
git tag v2.3.3
git push origin v2.3.3
```

### 3. workflow 自动做的事

1. **校验 tag 与 `package.json` 版本一致**（`v2.3.3` ↔ `2.3.3`），不一致直接失败——避免发出一个版本号对不上的包。
2. `npm ci` → `npm run typecheck` → `npm test`（97 个测试）。
3. `npm run build`（Vite 渲染层 + 主进程 + preload）。
4. `electron-builder --publish never` 打出 NSIS + zip。
5. 生成三个附加文件：
   - `desktop-update.json` —— 应用内更新器读的清单，`downloadUrl` 指向本次 Release 的 asset
   - `SHA256SUMS.txt` —— 安装包 + zip 的 sha256
   - `*.blockmap` —— electron-updater 差分更新用
6. 用 `softprops/action-gh-release` 建 Release（自动生成 release notes），上传上述全部资产。

### 4. 手动触发（不打 tag）

GitHub 仓库 → Actions → 「Release (Windows)」→ Run workflow，填版本号即可。适合补发。

### 5. 应用内更新怎么找到新版本

`electron/update.ts` 的默认来源已改为：

```
https://github.com/linyanyuan/IMusic-desktop/releases/latest/download/desktop-update.json
```

- `releases/latest` 指向**最新非预发布**版本；tag 名里带 `-`（如 `v2.4.0-beta.1`）会被判为预发布，不参与 `latest`。
- manifest 里的 `downloadUrl` 直接指向 GitHub asset，域名白名单已内置 `github.com`（GitHub asset 会 302 到 `objects.githubusercontent.com`，而校验只针对原始 URL，所以无需额外放行）。
- 老用户从 2.3.2 升级上来时，第一次检查仍会连旧的 `60.205.218.90`。要么让用户手动下载这一版，要么在旧服务器上放一个 `desktop-update.json` 指到 GitHub 的 2.3.3 做一次跳转。

---

## 四、代码签名（可选）

现在**没有签名证书**，安装包未签名，用户首次运行会看到 Windows SmartScreen 的
「Windows 已保护你的电脑」提示，需要点「更多信息 → 仍要运行」。

接入 EV/OV 证书后，在仓库 **Settings → Secrets and variables → Actions** 加两个 secret：

| Secret | 值 |
| --- | --- |
| `WIN_CSC_LINK` | base64 后的 `.p12` 证书（`[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.p12"))`） |
| `WIN_CSC_KEY_PASSWORD` | 证书密码 |

workflow 里已经传了这两个变量，配好后自动签名，无需改代码。

---

## 五、常见问题

**Q：tag 推了但 workflow 报版本不一致？**
`package.json` 的 `version` 必须和 tag 去掉 `v` 后完全一样。先改 `package.json` 并提交，再打 tag。

**Q：想同时发 Flutter 版？**
两套是独立的。Flutter 走 `scripts/package_windows.ps1 -Version x.y.z -BuildNumber n` + `scripts/publish_releases.ps1`，不要用 GitHub Actions。

**Q：release 目录越堆越大？**
`release*/` 全是被 gitignore 的构建产物，可随时删：
```bash
rm -rf electron-app/release electron-app/release-build*
```

**Q：本地想验证 workflow 打的包？**
`npm run release:github`（= 类型检查 + 测试 + `electron-builder --publish never`），产物在 `electron-app/release/`。
