/**
 * 收藏（♥）统一入口 —— 等价 Dart 端每处 `_toggleFavorite` 的登录门：
 *   lib/desktop/screens/desktop_search_screen.dart:1115
 *   lib/desktop/screens/desktop_favorites_history_screens.dart:293
 *   lib/desktop/screens/desktop_playlist_detail_screen.dart:815
 *   lib/desktop/widgets/desktop_lyrics_window_controller.dart:194
 * 四处都是同一个模式：token 为 null / 空 → SnackBar「请先登录」（2s）并 return，
 * 请求根本不发；成功路径 await toggleLike，失败再提示「操作失败」。
 *
 * Electron 移植时把这一层丢了：未登录点 ♥ → LibraryService 先做本地乐观更新 →
 * PUT /library 带空 Bearer → 401 → 回滚本地。用户只看到心形闪一下又变回去，
 * 全程没有任何提示，看起来像「点了没反应」。
 *
 * 所以这里收敛成单点守卫，7 个入口（PlayerBar / SongTable / DesktopLyricsBridge /
 * FavoritesView / HomeView / LibraryView / SearchView）共用，避免各写一遍判断漂移。
 * 顺带修掉原来 `void library.toggleLike(...)` 的未处理 rejection。
 */

import type { AuthService } from '../services/auth'
import type { LibraryService } from '../services/library'
import type { Song } from '../services/models'
import { showNotice } from './notice'

/**
 * 切换「喜欢」状态，带登录门：
 * - 未登录：不发请求，提示「请先登录」（对应 Dart 端 SnackBar）
 * - 已登录：调用 toggleLike；失败时提示（原来失败是静默的 / 未处理的 rejection）
 */
export function toggleLikeGuarded(
  auth: AuthService,
  library: LibraryService,
  song: Song,
): void {
  if (!auth.isLoggedIn) {
    showNotice('请先登录')
    return
  }
  void library.toggleLike(song).catch(() => {
    showNotice('收藏失败，请稍后重试')
  })
}
