/**
 * 分类详情页的 Tab 记忆 —— 「热门歌单 / 热门单曲」在进出专注模式后保持不变。
 *
 * 为什么需要：进入专注模式时 CategoryView 会卸载重建（route 被 FocusView 覆盖），
 * 组件内 useState 会被重置，所以离开前的 Tab 必须记在组件之外。这里用模块级记忆
 * 承担该职责，生命周期显式（无 React 依赖、无副作用），也便于单测。
 *
 * key 约束：只能是 `src/state/genres.ts` 里 `GENRES` 导出的有限分类 key 集合
 * （分类页的路由参数来源）。正因为候选集有限，这份记忆的条目数上界就是分类数量，
 * 不会随用户操作无界增长 —— 请不要把任意字符串（如歌单 id、搜索词）当 key 传进来，
 * 否则它会退化成永不回收的全局缓存。
 */

/** 分类页的两个 Tab（只在这两个值之间切换） */
export type CategoryTabId = 'playlists' | 'songs'

const tabByCategory = new Map<string, CategoryTabId>()

/** 读取某个分类上次停留的 Tab；没有记忆（首次进入）时返回 undefined */
export function readCategoryTab(categoryKey: string): CategoryTabId | undefined {
  return tabByCategory.get(categoryKey)
}

/** 记住某个分类当前选中的 Tab（按分类 key 隔离，互不串台） */
export function rememberCategoryTab(categoryKey: string, tab: CategoryTabId): void {
  tabByCategory.set(categoryKey, tab)
}

/** 仅供测试：当前记忆的条目数（用于断言内存有界） */
export function categoryTabMemorySize(): number {
  return tabByCategory.size
}
