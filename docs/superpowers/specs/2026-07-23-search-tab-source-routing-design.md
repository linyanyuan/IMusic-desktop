# 搜索 Tab 数据源路由设计

**状态：** 已批准  
**日期：** 2026-07-23

## 背景

当前 `DesktopSearchScreen` 只在展示阶段按 Tab 过滤同一份搜索结果，搜索请求没有携带 Tab 信息。`HybridMusicProvider` 又会根据 Metadata 是否在 800ms 内返回，选择不同的数据源组合，导致同一关键词可能得到不同列表。

本设计让搜索按钮或回车提交时，按当前 Tab 明确选择数据源。范围化搜索不再根据响应先后切换结果构成。

## 目标

| Tab | 请求的数据源 | 最终结果 |
| --- | --- | --- |
| 全部 | Metadata 与 Bilibili 并行 | Metadata 歌曲 + Bilibili 歌单 |
| 歌曲 | 仅 Metadata | 仅歌曲 |
| 歌单 | 仅 Bilibili | 仅歌单 |
| 艺人 | 保持现状 | 不新增艺人专用路由或展示逻辑 |

非目标：不自动在切换 Tab 时重新搜索，不修改播放、歌词、缓存或歌单详情逻辑，不为搜索引入流式增量结果。

## 接口设计

在 `music_provider.dart` 定义服务层枚举，避免服务层依赖桌面 UI 的 `SearchTab`：

```dart
enum MusicSearchScope { all, songs, playlists, artists }

Future<List<Map<String, dynamic>>> searchSongs(
  String query, {
  MusicSearchScope? scope,
});
```

`scope` 使用可选命名参数：

- `all`、`songs`、`playlists` 启用本设计的新路由。
- `artists` 走当前搜索行为，不新增功能。
- `null` 保留旧调用语义，避免未迁移调用点被静默改变。
- `scope` 必须是单次调用的局部参数，禁止保存到 `MusicService` 或任何 Provider 的实例字段，避免并发搜索互相污染。

`MusicService.searchSongs` 增加同名可选参数并原样传给 Provider；缓存结果和转换为 `Song` 的逻辑保持不变。

Hybrid 内部为歌词反查、播放 ID 解析等目的发起的搜索不属于用户 Tab 搜索，必须显式传 `scope: null` 或省略参数，保持原有默认语义，不继承外层搜索范围。

## 数据流

1. 用户按搜索按钮或回车。
2. `DesktopSearchScreen` 递增 request id，并捕获提交瞬间的 trimmed query 与当前 Tab/scope。
3. `MusicService.searchSongs(query, scope: scope)` 将范围传给 `HybridMusicProvider`。
4. `HybridMusicProvider` 按范围选择数据源、过滤结果并按固定规则合并。
5. 请求返回或失败时，只有 request id 仍为最新且 widget mounted 才能写入结果或关闭 loading。
6. 空 query 也必须递增 request id，清空结果并关闭 loading，使此前尚未完成的请求失效。

切换 Tab 本身仍只改变当前视图；只有再次提交搜索才会按新 Tab 请求对应数据源。

## Hybrid 路由

### 全部

- `all` 只属于 Hybrid 的组合语义：Hybrid 收到 `all` 后必须在本次调用内将其收窄，向 metadata 传 `songs`、向 Bilibili playback 路径传 `playlists`，禁止把 `all` 原样传给任何子 Provider。
- 同时启动 `metadata.searchSongs(query, scope: songs)` 和 Bilibili 歌单路径；Bilibili 路径向 playback 传 `scope: playlists`。
- 等待两侧完成或失败后再合并；删除以 800ms 响应时间决定数据构成的分支。
- 固定顺序为 Metadata 歌曲在前、Bilibili 歌单在后。
- 每个数据源内部保留其返回顺序，按非空 `id` 去重。
- 两侧调用使用各自的局部 scope，完成顺序不得影响结果构成。

### 歌曲

- 只调用 `metadata.searchSongs(query, scope: songs)`。
- 不启动 Bilibili 搜索，也不在 Metadata 失败时降级成 Bilibili 歌曲。
- Metadata 仍可由现有 `FallbackMusicProvider` 在 Meting 与 Default 之间降级。

### 歌单

- 只调用 Bilibili 搜索路径，并向 playback 传 `scope: playlists`。
- 不启动 Metadata 搜索，也不使用 Metadata 结果补位。
- 复用现有 Bilibili 歌单补充查询和去重规则。

### 艺人和未指定范围

- 保留当前搜索路径与 UI 行为。
- 本次不实现艺人专用数据源、过滤器或结果组件。

### Fallback 语义

- `songs`/`playlists`：先调用 primary 并按 scope 过滤；只有过滤后的 primary 为空或调用失败时，才调用 fallback，并对 fallback 做相同过滤。
- `all`/`artists`/`null`：保持当前“primary 原始结果非空即返回，否则调用 fallback”的原始回退语义，不做类型过滤。正常 Hybrid 全部搜索不会把 `all` 传入 Fallback；此规则只保证其他调用方直接传 `all` 时行为明确且兼容。
- scope 继续作为调用参数传递，禁止在 `FallbackMusicProvider` 中缓存。

## Bilibili 歌单路径

- 始终发起普通 `query`；仅当 trimmed query 不含“歌单”“合集”或大小写不敏感的 `playlist` 时，才发起“`query 歌单`”补充查询。
- 普通查询与补充查询可以并行，各自捕获错误并返回空列表。
- 合并顺序固定为普通查询在前、补充查询在后，不按 Future 完成顺序追加。
- 两组结果分别过滤为歌单后再合并；按 trimmed 非空 `id` 去重，首次出现者保留。

## 过滤规则

- 类型判断统一使用 `resultType.toString().trim().toLowerCase()`。
- 歌曲：类型缺失、trim 后为空或等于 `song`；显式排除 `playlist`、`artist` 及其他未知非空类型。
- 歌单：trim 后类型等于 `playlist`；其他类型全部排除。
- `id` 统一转字符串并 trim；空 `id` 丢弃，重复 `id` 保留固定合并顺序中的第一项。
- Metadata 歌曲继续经过 `_withBilibiliPlaybackSource`，保证后续播放解析行为不变。
- Bilibili 歌单继续补齐现有 `sourceLabel`。
- 合并逻辑不得按 Future 完成顺序追加结果。

## 错误与超时策略

- 全部 Tab 对两侧错误分别隔离：Metadata 失败仍展示 Bilibili 歌单，Bilibili 失败仍展示 Metadata 歌曲，两侧都失败时返回空列表。
- Bilibili 普通/补充查询也分别隔离：任一成功即可贡献合法歌单，两者都失败时该侧为空。
- 歌曲或歌单 Tab 的唯一数据源失败时返回空列表，沿用当前 UI 空状态。
- 不进行跨类型降级，例如 Metadata 失败后返回 Bilibili 歌曲。
- 继续使用各 Provider 现有网络超时；为保证结果构成稳定，全部 Tab 可能等待较慢的一侧直到其完成或超时。

## 兼容性与修改范围

- 生产实现必须迁移：`BilibiliMusicProvider`、`DefaultMusicProvider`、`FallbackMusicProvider`、`HybridMusicProvider`、`MetingMusicProvider`。
- 测试 fake 必须迁移：`playback_commands_test.dart` 的 `_ControlledPlaybackProvider`，`music_service_test.dart` 的 `_EchoLyricsProvider`，`hybrid_music_provider_test.dart` 的 `_MetadataProvider`、`_UnusedProvider`、`_PlaybackProviderWithLyrics`，`widget_test.dart` 的 `_FakeMusicProvider` 与 `_SearchRecordingMusicProvider`。
- 所有实现与 override 都接受相同可选命名参数；现有无 scope 调用保持可编译。
- `FallbackMusicProvider` 按上述规则传递并过滤 scope；基础 Metadata/Bilibili Provider 可接受参数，由 Hybrid/Fallback 负责最终路由与过滤。
- `SearchTab` 与 `MusicSearchScope` 通过显式映射连接，不把桌面枚举下沉到 services。
- 不修改 `Song` 模型、缓存键、播放 ID 或结果 JSON 字段。

预计涉及 `music_provider.dart`、`music_service.dart`、`hybrid_music_provider.dart`、`fallback_music_provider.dart`、各 Provider 的方法签名、`desktop_search_screen.dart` 及对应测试；不要求额外架构重构。

## TDD 测试

1. 在 `music_service_test.dart` 用记录型 Provider 验证 scope 被原样转发，缓存和 `Song` 转换不变。
2. 在 `hybrid_music_provider_test.dart` 先写失败测试：
   - 全部模式无论 Metadata 或 Bilibili 哪个先完成，结果 ID、类型和顺序一致。
   - 全部模式必须把 `all` 收窄为 Metadata 的 `songs` 与 playback 的 `playlists`，子 Provider 永远收不到 `all`，且结果只包含 Metadata 歌曲与 Bilibili 歌单。
   - 歌曲模式只调用 Metadata，且排除 artist/playlist。
   - 歌单模式只调用 Bilibili，且排除普通 Bilibili 歌曲。
   - 类型 trim/大小写、未知类型、空 id、重复 id 和 source 标记符合过滤规则。
   - Metadata/Bilibili 单侧失败及双侧失败分别得到部分结果或空列表。
   - 同一 Hybrid 实例并发执行 `songs` 与 `playlists` 搜索并反序完成时，各自只调用正确数据源、传递正确 scope、返回正确类型，结果互不污染；该测试必须能捕获实例级 `activeScope` 一类错误实现。
   - Hybrid 内部歌词/播放反查使用 `null` 默认语义；artists 与未指定范围保持旧路径。
3. 为 `FallbackMusicProvider` 增加测试：primary 原始非空但 `songs`/`playlists` 过滤后为空时必须调用 fallback，fallback 结果也必须过滤；`artists`/`null` 保持旧语义；其他调用方直接传 `all` 时使用原始结果判断回退且不做类型过滤。
4. 为 Bilibili 歌单路径增加测试：普通/补充查询完成顺序和单侧失败不影响固定顺序；query 已含歌单/合集/playlist 时不补查。
5. 在 `widget_test.dart` 验证 Tab 到 scope 的映射，以及两个请求倒序完成时只有最新请求写结果/loading；提交空 query 后旧请求不能回写。
6. 使用 fake/completer 控制完成顺序，不依赖真实网络或 800ms 墙钟等待。依次运行定向测试、`dart analyze` 和完整 `flutter test --no-pub`；`dart analyze` 必须验证所有 override 签名已迁移。

## 验收标准

- 全部 Tab 每次提交都只显示 Metadata 歌曲和 Bilibili 歌单。
- 歌曲 Tab 搜索期间 Bilibili 搜索调用次数为 0。
- 歌单 Tab 搜索期间 Metadata 搜索调用次数为 0。
- 响应完成顺序不会改变全部 Tab 的数据源构成与合并顺序。
- Hybrid 不向子 Provider 传 `all`；同一实例上的并发 `songs`/`playlists` 请求即使反序完成也互不污染。
- 单侧失败不会清空另一侧已成功的合法结果。
- Bilibili 普通/补充查询始终按普通在前、补充在后去重，且命中歌单关键词时不补查。
- 旧请求、失败的旧请求和被空 query 取消的请求都不能覆盖最新结果或 loading 状态。
- 艺人 Tab 的请求和展示行为与改动前一致。
- scope 不存入实例状态，Hybrid 内部反查保持 `null` 语义；Fallback 直接收到 `all` 时保持旧原始回退语义。
- 所有生产 Provider 与测试 fake 的 override 完成迁移，`dart analyze` 和全部测试通过。
