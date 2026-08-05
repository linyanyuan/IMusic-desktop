# 桌面端搜索 / 播放改动说明（移动端移植指南）

> 日期：2026-07-28  
> 对应仓库：`IMusic-desktop` / 分支 `main`  
> 目的：说明桌面端「搜索 + 播放」怎么改的，方便移动端同步；并解释 **同步过去的 GDStudio 歌曲为什么播不了**。

---

## 1. 一句话结论

桌面端在 **「歌曲」搜索 tab** 引入了 **GDStudio 直链音源**：

1. 搜索结果 `id` 形如：`gdstudio:{source}:{url_id}`  
   例：`gdstudio:joox:0QLF56OE5myG3ClImaYFZQ==`、`gdstudio:kuwo:197691205`
2. 播放时若 `id` 以 `gdstudio:` 开头，走 **GDStudio `types=url` 取直链**，通常 **无自定义 headers**，可直接 `UrlSource` 流式播放。
3. 若取链失败，再 **按标题回退 B 站搜索播放**。

**移动端播不了同步歌单里的 GDStudio 歌，根因几乎一定是：**

- 云同步/本地库里的 `id` 已是 `gdstudio:…`
- 但移动端 `getPlayUrl` / 播放链路 **只认 `bilibili:` / `meting:`**，不认识 `gdstudio:`  
→ 取链失败或走错分支。

**移动端最小修复：识别 `gdstudio:` ID，并实现与桌面相同的 GDStudio 取链。**

---

## 2. 改动全景（桌面）

```
搜索 UI (tab)
    │
    ├─ 全部   → Hybrid.searchSongs          (Meting 元数据 + B站视频/歌单)
    ├─ 歌曲   → Hybrid.searchMetadataSongs  (优先 GDStudio，失败再 Meting)
    └─ 歌单   → Hybrid.searchBilibiliPlaylists (仅 B站)
         │
         ▼
MusicService.searchSongs(query, scope, page)
         │
         ▼
    结果 Song / Map 写入缓存 + 列表
         │
用户点击播放
         │
         ▼
startSongPlayback
  1. status = loading（立刻）
  2. stop 当前播放
  3. musicService.getPlayUrl(song.id)
       ├─ gdstudio:* → GdStudioMusicClient.getPlayUrl  (直链, headers={})
       │                 失败 → 按 title 解析 B站 playbackId
       ├─ bilibili:* → BilibiliMusicProvider.getPlayUrl (常有 Referer headers)
       └─ meting:*   → 元数据 + 解析 B站 playbackId
  4. 若 headers 非空 → 先下载到本地缓存再播（Windows audioplayers 不支持自定义头）
     若 headers 为空 → 直接 UrlSource 流式播（GDStudio 走这里）
  5. setSource → resume → status = playing
  6. 歌词异步补全（不挡开播）
```

### 关键文件

| 文件 | 职责 |
|------|------|
| `lib/services/gdstudio_music_client.dart` | GDStudio HTTP 客户端：搜索 / 取 URL / 歌词 / 封面 |
| `lib/services/hybrid_music_provider.dart` | 搜索分流 + `getPlayUrl` 对 `gdstudio:` 优先直链 |
| `lib/services/music_service.dart` | `MusicSearchScope` + `page` 透传 |
| `lib/desktop/screens/desktop_search_screen.dart` | tab 映射 scope、加载更多分页 |
| `lib/playback/playback_actions.dart` | 开播流程：loading → 取链 → setSource → resume |
| `lib/desktop/widgets/desktop_player_bar.dart` | loading 条：引擎已 playing 时关掉不确定进度 |

---

## 3. 歌曲 ID 约定（跨端必须一致）

### 3.1 格式

```
gdstudio:{source}:{mediaId}
```

| 段 | 含义 | 示例 |
|----|------|------|
| `gdstudio` | 固定前缀 | |
| `source` | 音源站点 | `joox` / `kuwo` / `netease` … |
| `mediaId` | 该站的 `url_id`（或搜索返回的 `id`） | base64 或数字字符串 |

解析规则（桌面实现）：

```dart
// 去掉 "gdstudio:" 后，按第一个 ':' 切开
// source = rest[0..sep)
// mediaId = rest[sep+1..]   // 可含 '=' 等 base64 字符
static bool isGdStudioId(String id) => id.startsWith('gdstudio:');
```

### 3.2 搜索结果 Map 必带字段（入库/同步建议保留）

从 GDStudio 搜索映射出的歌曲 map（`mapSearchItem`）：

| 字段 | 必需 | 说明 |
|------|------|------|
| `id` | ✅ | `gdstudio:{source}:{url_id}` |
| `title` | ✅ | 歌名 |
| `artist` | 建议 | 歌手 |
| `resultType` | ✅ | 固定 `"song"` |
| `source` / `gdstudioSource` | ✅ | 如 `joox` |
| `url_id` | 建议 | 与 id 内 mediaId 一致 |
| `lyric_id` | 建议 | 取歌词用 |
| `pic_id` | 可选 | 封面 |
| `coverUrl` | 可选 | 可 CDN 拼出 |
| `preferDirectUrl` | 可选 | 提示播放层直链流式 |
| `duration` | 可选 | 毫秒；搜索常缺失 |

**同步到云端/移动端时：至少要保住 `id`（完整 `gdstudio:…`）。**  
若同步时把 id 截断、改写成数字、或只存 title，移动端无法取链。

---

## 4. GDStudio API（移动端可原样调用）

Base：

```
https://music-api.gdstudio.xyz/api.php
```

建议请求头：

```
User-Agent: Mozilla/5.0 ...
Accept: application/json, text/javascript, */*; q=0.01
```

### 4.1 搜索

```
GET ?types=search&source={joox|kuwo|netease}&name={关键词}&count=20&pages={页码从1起}
```

- 响应：JSON 数组  
- 常用字段：`name`, `artist`（数组或字符串）, `album`, `url_id` / `id`, `lyric_id`, `pic_id`, `source`
- **桌面策略**  
  - 第 1 页音源顺序：`joox` → `kuwo` → `netease`（谁先有结果用谁）  
  - 加载更多：优先会翻页的 `kuwo`（`joox` 实测常忽略 `pages`）

### 4.2 取播放地址（开播关键路径）

```
GET ?types=url&source={source}&id={mediaId}&br={192|128|320|999}
```

- 响应：`{ "url": "https://...", "br": 192, "size": ... }`  
- `br == -1` 或空 `url` → 失败，试下一码率  
- 桌面顺序：`192 → 128 → 320 → 999`，**每次最多等 5s**  
- 返回的 `url` 一般是 **可直接播放的 https 直链，无需 B 站那种 Referer headers**  
- 相对路径少见；若无 `http` 开头，桌面拼：`https://music.gdstudio.xyz/{path}`

### 4.3 歌词（异步，不挡开播）

```
GET ?types=lyric&source={source}&id={lyricId}
```

- 响应：`{ "lyric": "..." }`  
- 桌面：**取链路径不 await 歌词**；开播后由 `getLyrics` 再拉。

### 4.4 封面

```
GET ?types=pic&source={source}&id={picId}&size=300
```

或 CDN 提示（不请求）：

- joox：`https://image.joox.com/JOOXcover/0/{picId}/300`  
- kuwo：`https://img1.kwcdn.kuwo.cn/star/albumcover/{picId}`

---

## 5. 播放链路（桌面 `startSongPlayback`）

伪代码：

```text
serial++
UI: song.status = "loading"     // 立刻反馈
player.stop()
rememberSongs(queue + song)     // 写入内存缓存，供 getPlayUrl / 封面

play = getPlayUrl(song.id)
  if id startsWith "gdstudio:":
      try: return GdStudio.getPlayUrl(id)   // headers 空
      catch: resolve Bilibili by title → Bilibili.getPlayUrl
  else if bilibili: Bilibili.getPlayUrl     // 常有 headers
  else if meting: detail + Bilibili

if play.headers not empty:
    localPath = downloadWithHeaders(play)   // 桌面 Windows 需要
    source = DeviceFileSource(localPath)
else:
    source = UrlSource(play.url)            // GDStudio 走这里

player.setSource(source)
player.resume()   // 桌面加了 8s timeout，避免永久卡 loading
UI: song.status = "playing"
async loadLyrics(song)   // 不阻塞
```

### 移动端差异注意

| 点 | 桌面 | 移动端建议 |
|----|------|------------|
| 播放器 | `audioplayers` | 你们现有播放器即可 |
| headers | 不支持 → 先下载 | 若支持自定义 headers，B站可直链；**GDStudio 通常仍无 headers** |
| loading UI | `status==loading && !enginePlaying` 才转圈 | 同样建议：引擎已播就关 spinner |
| 歌词 | 开播后异步 | 同上，别挡 `getPlayUrl` |

---

## 6. 搜索 UI 与分页（可选移植）

### 6.1 Tab → Scope

| UI Tab | `MusicSearchScope` | 实际数据源 |
|--------|-------------------|------------|
| 全部 | `all` | Meting(+Default) 歌曲 + B站结果 |
| 歌曲 | `metadataSongs` | **GDStudio 优先**，空则 Meting |
| 歌单 | `bilibiliPlaylists` | 仅 B站 `resultType=playlist` |

### 6.2 分页

- `searchSongs(query, scope, page)`，`page` 从 1 起  
- UI「加载更多」：`page+1`，**追加**结果，按 `id` 去重  
- `hasMore` 启发式：本页 raw 条数 ≥ 20 且有新增 id  

移动端若暂不分页，至少保证 **第 1 页 GDStudio 搜索 + 取链** 可用。

---

## 7. 为什么「同步过去的 GDStudio 歌单」移动端播不了

### 7.1 典型失败链

```
桌面搜索 → id = gdstudio:kuwo:123
用户「喜欢 / 加入歌单」→ 云同步写库
移动端拉库 → 列表能显示 title/artist
用户点击播放 → 移动端 getPlayUrl("gdstudio:kuwo:123")
  → 旧逻辑：当未知 id / 当 bilibili / 当 meting
  → 抛错或空 URL
  → 无法播放
```

### 7.2 移动端检查清单

1. **日志打印**点击时的 `song.id`  
   - 若是 `gdstudio:…` → 必须走 GDStudio 取链  
   - 若 id 被改掉（只有数字、空、其它前缀）→ 同步层丢了 id，要先修同步字段  
2. **getPlayUrl 分支**是否包含 `gdstudio:`  
3. **网络**：能否访问 `music-api.gdstudio.xyz`（部分网络环境可能拦）  
4. **解析 mediaId**：joox 的 id 含 `+` `/` `=`，不要 URL 二次编码错误或被截断  
5. **不要**把 `gdstudio:` 歌强行塞进「仅 B 站」的播放器分支而不做回退

### 7.3 最小补丁（移动端）

```text
// 伪代码
PlaybackUrl getPlayUrl(String id) {
  if (id.startsWith("gdstudio:")) {
    final (source, mediaId) = parseGdStudioId(id);
    for (br in [192, 128, 320]) {
      url = GET api.php?types=url&source=source&id=mediaId&br=br
      if (url ok) return PlaybackUrl(url, headers: {});
    }
    // 可选：标题搜 B站回退
    throw "GDStudio 取链失败";
  }
  // 原有 bilibili / meting ...
}
```

**不必**先做完整搜索 UI；只要播放路径认 `gdstudio:`，同步歌单就能播。

可选：从桌面复制整个 `gdstudio_music_client.dart`（几乎无 Flutter UI 依赖，仅 Dio + map）。

---

## 8. 建议的移动端移植顺序

| 优先级 | 任务 | 验收 |
|--------|------|------|
| P0 | `parseSongId` + `types=url` 取链 | 对库里任意 `gdstudio:joox:…` / `gdstudio:kuwo:…` 能出 URL |
| P0 | 播放器用该 URL 开播（无 headers） | 同步歌单内歌曲可听 |
| P1 | 取链失败时按 `title`+`artist` 回退 B站 | 个别 GDStudio 失败仍可播 |
| P1 | 歌词 `types=lyric` 异步 | 不挡开播 |
| P2 | 歌曲搜索走 GDStudio | 与桌面「歌曲」tab 一致 |
| P2 | 分页 load-more | 与桌面一致 |
| P3 | 封面 CDN / types=pic | 体验 |

---

## 9. 手动验证（curl / 浏览器）

把 `{source}`、`{id}` 换成真实值：

```bash
# 搜索
curl -sG "https://music-api.gdstudio.xyz/api.php" \
  --data-urlencode "types=search" \
  --data-urlencode "source=kuwo" \
  --data-urlencode "name=AOA" \
  --data-urlencode "count=5" \
  --data-urlencode "pages=1" \
  -H "User-Agent: Mozilla/5.0"

# 取链（用搜索结果的 url_id）
curl -sG "https://music-api.gdstudio.xyz/api.php" \
  --data-urlencode "types=url" \
  --data-urlencode "source=kuwo" \
  --data-urlencode "id=197691205" \
  --data-urlencode "br=192" \
  -H "User-Agent: Mozilla/5.0"
```

拿到 `url` 后在手机浏览器/播放器直接打开，确认链路通。

---

## 10. 与旧路径对比

| 场景 | 旧（改前） | 新（桌面现状） |
|------|-----------|----------------|
| 歌曲搜索 | Meting/Default 元数据，播时再找 B站 | **GDStudio 搜索 + 直链**，失败再 B站 |
| 全部 tab | 元数据 + B站 | 不变（仍非 GDStudio 优先） |
| 歌单 tab | B站 | 不变 |
| 播放 GDStudio id | 无此 id | **直链优先** |
| 播放 B站 | headers 下载/缓存 | 不变 |
| 开播反馈 | 易卡 loading | 立刻 loading；引擎 playing 后关条；resume 超时兜底 |

---

## 11. 代码锚点（桌面仓库）

```
lib/services/gdstudio_music_client.dart     # 客户端全文
lib/services/hybrid_music_provider.dart     # searchMetadataSongs / getPlayUrl gdstudio 分支
lib/services/music_service.dart             # MusicSearchScope + page
lib/playback/playback_actions.dart          # startSongPlayback
lib/desktop/screens/desktop_search_screen.dart  # tab / 加载更多
test/gdstudio_music_client_test.dart        # id 解析、pages、取链单测
```

---

## 12. 假设与边界（写给移植时）

1. **GDStudio 是第三方公开 API**，稳定性/地区可用性不保证；必须保留 B站回退。  
2. **直链可能有防盗链/过期**；失败应重新 `types=url`，不要长期缓存失效 URL 当永久地址。  
3. **时长**搜索结果经常没有；UI 显示 `0:00` 正常，播放后再取 duration。  
4. 桌面 **「全部」tab 仍不是 GDStudio**；只有「歌曲」tab 与入库的 `gdstudio:` id 依赖该链路。  
5. 若移动端库里历史数据只有 title 没有 `gdstudio:` id，需要重新搜索匹配，无法凭空还原 url_id。

---

## 13. 给移动端的「最小可运行」接口草图

```dart
class GdStudioMusicClient {
  static const baseUrl = 'https://music-api.gdstudio.xyz/api.php';
  static const idPrefix = 'gdstudio:';

  static bool isGdStudioId(String id) => id.startsWith(idPrefix);

  static (String source, String mediaId)? parseSongId(String id) {
    if (!isGdStudioId(id)) return null;
    final rest = id.substring(idPrefix.length);
    final sep = rest.indexOf(':');
    if (sep <= 0 || sep >= rest.length - 1) return null;
    return (rest.substring(0, sep), rest.substring(sep + 1));
  }

  /// 返回可播放 https URL；失败抛错。
  Future<String> resolvePlayUrl(String songId) async { /* types=url 循环 br */ }

  Future<List<Map<String, dynamic>>> searchSongs(String q, {int page = 1}) async { /* 可选 */ }
}
```

在现有 `getPlayUrl` 最前面加：

```dart
if (GdStudioMusicClient.isGdStudioId(id)) {
  final url = await gdStudio.resolvePlayUrl(id);
  return PlaybackUrl(url, headers: const {});
}
```

完成以上两点后，**同步歌单里的 GDStudio 曲目应可播放**。

---

*文档对应桌面实现：`main` @ 合并提交「streaming playback + search pagination + GDStudio」。*
