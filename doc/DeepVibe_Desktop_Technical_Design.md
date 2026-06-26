# DeepVibe 桌面端技术设计文档

## 1. 技术目标

桌面端应最大化复用移动端已验证的业务逻辑，尤其是搜索、播放、队列、歌词、歌单、曲库同步和账号会话。首版建议继续使用 Flutter Desktop，以减少跨端重写成本，并在 UI 层按桌面信息架构重组。

目标：

1. 复用 `MusicProvider` 抽象与现有 provider 实现。
2. 复用 `DeepVibeApiClient`、认证、远端曲库同步和更新检查服务。
3. 将当前 `lib/main.dart` 中过大的页面与业务逻辑逐步拆分，形成桌面/移动可共享核心层。
4. 建立桌面端专属 UI、快捷键、窗口状态和播放器上下文。
5. 保持测试可覆盖关键行为，尤其是播放恢复、队列切换和加载更多不跳动。

## 2. 推荐技术栈

继续使用：

- Flutter Desktop：Windows 首发，后续可扩展 macOS/Linux。
- Dart。
- flutter_riverpod：状态管理。
- just_audio：音频播放。
- audio_service：系统媒体控制，桌面能力需按平台验证。
- dio：网络请求。
- cached_network_image：封面缓存。

可新增但非首版必须：

- window_manager：窗口尺寸、居中、最小尺寸、迷你模式。
- hotkey_manager：应用级快捷键。
- tray_manager：系统托盘。
- bitsdojo_window 或自绘标题栏方案：如需要无边框窗口。

新增依赖必须有明确用途，不为“可能需要”提前引入。

## 3. 当前移动端核心逻辑梳理

### 3.1 数据源抽象

`MusicProvider` 定义：

- `searchSongs(query)`：搜索歌曲、歌单、歌手/集合。
- `getRecommendedSongs()`：推荐歌曲。
- `getHotPlaylists({limit})`：热门歌单，可限制数量。
- `getPlaylist(id, {limit})`：歌单详情或集合详情。
- `getSongDetail(id)`：歌曲详情。
- `getPlayUrl(id)`：播放地址、headers、歌词、resolvedId。
- `getLyrics(song)`：歌词获取。
- `rememberSongs(songs)`：缓存已知歌曲元数据。

主要实现：

- `BilibiliMusicProvider`：Bilibili 搜索、歌单、播放 URL、字幕。
- `MetingMusicProvider`：元数据搜索与歌词。
- `DefaultMusicProvider`：Karpov 聚合接口备用。
- `FallbackMusicProvider`：主备容错。
- `HybridMusicProvider`：元数据与 Bilibili 播放源融合，是桌面端应复用的核心。

### 3.2 播放状态

当前关键 provider：

- `currentSongProvider`
- `loadedPlaybackProvider`
- `playbackQueueProvider`
- `priorityNextSongsProvider`
- `currentSongIndexProvider`
- `playbackModeProvider`
- `playbackQualityProvider`
- `playbackPositionProvider`
- `playbackDurationProvider`
- `playbackPlayingProvider`

桌面端必须保留 `loadedPlaybackProvider` 的语义：已加载音源是播放器真实状态，不能只依赖当前歌曲 map 是否有 `playUrl`。暂停恢复应优先 resume 已加载音源。

### 3.3 曲库状态

- `likedSongsProvider`
- `userPlaylistsProvider`
- `recentSongsProvider`
- `offlineCachedSongsProvider`
- `offlineCacheStatusProvider`
- `libraryStorageProvider`
- `authSessionProvider`
- `apiClientProvider`

桌面端首版可复用移动端本地存储通道，但需要确认 Windows/macOS 文件目录实现。如果当前 MethodChannel 仅 Android 实现，桌面端需提供 `DesktopLibraryStorage`。

## 4. 建议目录结构

当前 `lib/main.dart` 文件承载过多页面、状态和工具函数。桌面开发前建议做最小拆分，不做大规模重构。

推荐结构：

```text
lib/
  app/
    deepvibe_app.dart
    theme.dart
  core/
    models/
      song.dart
      playlist.dart
    playback/
      playback_controller.dart
      playback_state.dart
      playback_actions.dart
    library/
      library_storage.dart
      library_actions.dart
  services/
    music_provider.dart
    hybrid_music_provider.dart
    bilibili_music_provider.dart
    meting_music_provider.dart
    fallback_music_provider.dart
    default_music_provider.dart
    deepvibe_api_client.dart
  mobile/
    screens/
  desktop/
    desktop_app_shell.dart
    screens/
      desktop_home_screen.dart
      desktop_search_screen.dart
      desktop_library_screen.dart
      desktop_playlist_detail_screen.dart
      desktop_settings_screen.dart
    widgets/
      desktop_sidebar.dart
      desktop_now_playing_rail.dart
      desktop_player_bar.dart
      desktop_song_table.dart
      desktop_queue_panel.dart
```

拆分原则：

- 先抽共享逻辑，再写桌面 UI。
- 不一次性重写移动端。
- 每次移动代码后跑现有测试。
- 新桌面 UI 通过共享 actions 调用播放和曲库逻辑。

## 5. 桌面端架构

### 5.1 分层

```text
Desktop UI Layer
  - desktop shell
  - sidebar, workbench, right rail, player bar

Application State / Actions
  - Riverpod providers
  - playback actions
  - library actions
  - search actions

Domain / Service Layer
  - MusicProvider implementations
  - DeepVibeApiClient
  - storage adapters

Platform Layer
  - just_audio
  - window manager
  - hotkeys
  - tray/media keys
```

### 5.2 数据流

搜索播放流程：

1. 用户在桌面搜索框输入关键词。
2. `DesktopSearchController` 调用 `musicServiceProvider.searchSongs`。
3. `HybridMusicProvider` 先尝试元数据搜索，同时并行 Bilibili 播放源搜索。
4. UI 分组展示歌曲、歌单、歌手/集合。
5. 点击歌曲调用共享 `_startSongPlayback` 等价 action。
6. action 设置队列、current index、loading 状态。
7. `getPlayUrl` 返回 URL 后，`playbackController.playUrl` 设置音源并播放。
8. 写入 `loadedPlaybackProvider`、最近播放和稳定播放元数据。
9. 桌面底部播放栏、右侧歌词/队列同步更新。

暂停恢复流程：

1. 用户点击暂停。
2. `playbackController.pause()`。
3. `currentSong.status = paused`。
4. 不清空 `loadedPlaybackProvider`。
5. 用户点击播放。
6. 如果 `loadedPlaybackProvider` 与当前歌曲匹配且有 `playUrl`，只调用 `resume()`。
7. 如果没有已加载音源，再走 `getPlayUrl`。

热门歌单加载更多流程：

1. 桌面首页初始化请求 `getHotPlaylists(limit: 12)`。
2. 本地保存已加载列表。
3. 滚动接近底部时增加 limit 或 page size。
4. 请求期间保留旧列表，只显示底部加载状态。
5. 请求成功后替换为更长列表或追加去重。
6. 不允许中央工作区高度骤然缩短。

## 6. 桌面 UI 状态设计

### 6.1 Shell 状态

建议 provider：

- `desktopRouteProvider`：home/search/library/settings/playlistDetail。
- `desktopRightRailTabProvider`：queue/lyrics/info。
- `desktopSearchQueryProvider`。
- `desktopWindowModeProvider`：normal/mini/focus。

### 6.2 搜索状态

建议使用 `AsyncNotifier` 或 `StateNotifier` 管理：

- query
- status: idle/loading/success/error
- results
- selectedFilter
- lastSuccessfulResults

搜索失败不应清空旧结果，避免桌面工作区闪动。

### 6.3 首页推荐状态

桌面端不要用 changing future key 整块替换 UI。应使用本地 controller 缓存列表：

- items
- isLoading
- hasMore
- error
- requestedLimit

## 7. 桌面组件规范

### 7.1 DesktopAppShell

职责：

- 管理全局布局：左侧导航、中间工作区、右侧栏、底部播放栏。
- 注册快捷键。
- 管理窗口模式。
- 持有系统媒体控制回调。

### 7.2 DesktopSongTable

职责：

- 展示歌曲列表。
- 支持单击选择、双击播放。
- 支持右键菜单。
- 支持多选和批量操作。

字段建议：

- 标题
- 艺人/UP 主
- 专辑/来源
- 时长
- 播放源
- 喜欢状态
- 缓存状态

### 7.3 DesktopPlayerBar

职责：

- 统一播放控制。
- 展示进度、音量、模式、来源。
- 保持稳定高度，不随状态跳动。

### 7.4 DesktopQueuePanel

职责：

- 当前队列展示。
- 当前歌曲高亮。
- 支持拖拽排序、删除、点击播放。

### 7.5 DesktopLyricsPanel

职责：

- 展示歌词加载、无歌词、逐行歌词。
- 与播放进度同步高亮。

## 8. 桌面平台适配

### 8.1 Windows MVP

优先支持 Windows：

- 窗口最小尺寸 1024x720。
- 推荐默认尺寸 1280x820。
- 支持系统媒体键需要验证 audio_service 桌面支持情况；不稳定则首版只做应用内快捷键。
- 本地存储使用用户 AppData 目录。

### 8.2 快捷键

建议首版快捷键：

- Space：播放/暂停。
- Ctrl+F：聚焦搜索。
- Ctrl+L：打开歌词/当前播放。
- Ctrl+K：快速搜索/命令面板。
- Left/Right：seek 5 秒。
- Ctrl+Left/Ctrl+Right：上一首/下一首。
- Up/Down：音量。

### 8.3 迷你播放器

首版可做应用内 mini mode：

- 小窗口 360x110。
- 展示封面、标题、艺人、播放/暂停、上一首/下一首。
- 不展示复杂队列和歌词。

## 9. 存储与同步

### 9.1 本地存储

桌面端需要实现 `LibraryStorage`：

- Windows: `%APPDATA%/DeepVibe` 或 `%LOCALAPPDATA%/DeepVibe`。
- macOS: `~/Library/Application Support/DeepVibe`。
- Linux: `~/.local/share/deepvibe`。

存储内容：

- recent songs
- liked songs
- user playlists
- offline cached songs/status
- user profile
- theme mode
- search history
- auth session

### 9.2 远端同步

继续使用 `DeepVibeApiClient`：

- login/register/logout
- getMe
- loadLibrary
- saveLibrary
- updateProfile
- uploadAvatar
- check update

安全要求：

- token 不写日志。
- API key 不提交仓库。
- 生产包避免 localhost 和非 HTTPS，当前 fallback 规则继续保留。

## 10. 测试策略

### 10.1 单元测试

- `MusicProvider` 解析与 fallback。
- `HybridMusicProvider` 匹配、播放源解析、歌词策略。
- 桌面 storage 路径和序列化。

### 10.2 Widget 测试

- 桌面 shell 布局在 1024、1280、1920 宽度下不溢出。
- 搜索结果表格渲染。
- 底部播放栏状态变化。
- 右侧队列点击播放。
- 首页加载更多不跳动。

### 10.3 行为回归

必须覆盖：

- 暂停后恢复不重新加载音源。
- 播放失败恢复上一状态。
- 删除当前歌曲切换下一首。
- 下一首播放优先于随机模式。
- 歌词加载不阻塞播放。

## 11. 实施建议

阶段 1：核心拆分

- 抽出 playback actions。
- 抽出 library actions。
- 抽出 shared widgets/model helpers。
- 保证移动端测试仍可运行。

阶段 2：桌面 shell

- 创建 `desktop/desktop_app_shell.dart`。
- 做左导航、中央工作区、右栏、底部播放栏。
- 接入当前 provider 状态。

阶段 3：核心页面

- 首页。
- 搜索。
- 歌单详情。
- 我的音乐。
- 设置。

阶段 4：桌面增强

- 快捷键。
- 右键菜单。
- 队列拖拽。
- 迷你播放器。

阶段 5：打包与发布

- Windows debug/release 构建。
- 本地存储路径验证。
- 崩溃日志和基础诊断。

## 12. 风险与对策

风险：`lib/main.dart` 过大，桌面开发继续堆叠会失控。

对策：先抽共享 actions，再写桌面 UI。

风险：Bilibili Web 接口不稳定。

对策：保留 fallback、错误提示、缓存已知元数据。

风险：桌面媒体键支持不稳定。

对策：首版保证应用内快捷键，系统级媒体键作为 P1。

风险：全量 widget 测试有旧用例未等待启动页。

对策：桌面开发前整理测试 helper，例如 `pumpThroughLaunchSplash()`，修复旧测试稳定性。

