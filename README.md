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

## 开发说明

- 当前项目主要面向 Windows 桌面端。
- 播放、搜索、登录和曲库同步逻辑集中在 `lib/services/` 与 `lib/playback/`。
- 桌面歌词窗口使用 `desktop_multi_window` 创建独立 Flutter 子窗口。
- 构建产物、日志、IDE 配置、本地调试报告和本地 agent 状态已在 `.gitignore` 中忽略。

