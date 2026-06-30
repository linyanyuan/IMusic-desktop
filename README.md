# IMusic Desktop

IMusic Desktop 是一款基于 Flutter 构建的 PC 端音乐播放器，面向桌面场景重新设计了听歌、搜索、歌单管理、歌词展示和账号曲库同步体验。

它不是简单把移动端界面放大，而是采用更适合电脑使用的工作台布局：左侧常驻导航、中间主工作区、右侧播放上下文、底部稳定播放栏。用户可以一边搜索音乐和歌单，一边查看队列、歌词、收藏状态和播放信息。

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

- Flutter Desktop
- Dart
- Riverpod
- audioplayers
- Dio
- shared_preferences
- window_manager
- desktop_multi_window

## 项目结构

```text
lib/
  app/              应用入口、主题和整体配置
  core/             核心模型和通用状态
  desktop/          桌面端页面、壳层、侧边栏、播放栏和组件
  lyrics_window/    独立桌面歌词窗口
  playback/         播放状态和播放动作
  services/         登录、曲库、音乐源和网络服务
  shared/           歌词解析等共享工具
test/               回归测试和组件测试
windows/            Windows 桌面端工程配置
doc/                产品需求和技术设计文档
```

## 本地运行

请先安装 Flutter，并启用 Windows 桌面端支持。

```bash
flutter pub get
flutter run -d windows
```

运行测试：

```bash
flutter test
```

静态分析：

```bash
dart analyze
```

## 版本发布与软件内更新

桌面端内置更新读取服务器上的：

```text
http://60.205.218.90:8787/releases/desktop-update.json
```

服务器目录对应为：

```text
/opt/imusic-desktop/releases
```

### 1. 确认新版本号

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

### 2. 打包新版本

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

### 3. 上传服务器

把 `dist\releases\` 里的文件上传到服务器发布目录：

```powershell
ssh root@60.205.218.90 "mkdir -p /opt/imusic-desktop/releases"
scp .\dist\releases\* root@60.205.218.90:/opt/imusic-desktop/releases/
```

上传后检查 manifest 是否能访问：

```powershell
Invoke-WebRequest http://60.205.218.90:8787/releases/desktop-update.json
```

返回内容里应包含新版本号、下载地址和 `sha256`。

### 4. 测试软件内更新

1. 运行低于服务器版本的客户端，例如本地旧版是 `1.0.1+2`，服务器发布 `1.0.2`。
2. 打开软件设置里的检查更新，或重启软件等待自动检查。
3. 看到新版本弹窗后点击下载。
4. 下载完成后点击立即更新并退出。
5. 软件会退出、覆盖当前目录、再自动打开新版本。

### 5. 重要限制

- zip 更新要求当前客户端已经包含 zip 更新能力；非常早的旧客户端只支持 `.exe/.msi` 安装器更新。
- 如果要发布安装器，可以先用 Inno Setup、NSIS 等工具生成 `.exe/.msi`，再给脚本传 `-InstallerPath`。
- 更完整的命令和常见报错见 `scripts/package_windows_usage.md`。

## 开发说明

- 当前项目主要面向 Windows 桌面端。
- 播放、搜索、登录和曲库同步逻辑集中在 `lib/services/` 与 `lib/playback/`。
- 桌面歌词窗口使用 `desktop_multi_window` 创建独立 Flutter 子窗口。
- 构建产物、日志、IDE 配置、本地调试报告和本地 agent 状态已在 `.gitignore` 中忽略。
