/**
 * 首页「今日精选」的概念定义 —— 回答「何为精选」：
 *
 * 精选 ≠ 推荐 feed 的前两条（M8 之前的做法：recommended.slice(0, 2)，
 * 没有独立含义，还和推荐歌曲区内容重复，卡片上还挂着名不副实的
 * 「FEATURED PLAYLIST」标签 —— 其实是单曲）。
 *
 * 今日精选 = **以日期为种子的分类精选歌单**：
 * - 按「今天」从分类池里挑一个网易云分类（华语 / 粤语 / 摇滚 / …），
 *   取该分类「按热度排序」的前 8 个歌单做成首页轮播的大 hero 卡
 * - 当天固定（反复进首页不变），次日自动换分类 —— 有「今日」的真实含义
 * - 主题名与歌单**必然一致**：主题就是这批歌单的来源分类
 *
 * 种子用 UTC 天数（Date.now / 86400000）取模分类数，无需任何外部编辑数据源。
 *
 * 为什么不再用 B 站关键词池（hotPlaylistQueryForBatch）：
 * 热门歌单的真实数据源是网易云 `/api/playlist/list`，而 B 站关键词池只影响
 * provider 兜底分支。旧实现把「粤语经典合集」这种 B 站关键词当作标题、
 * 实际渲染的却是网易云「全部」分类的热门（韩语甜歌等），标题与内容完全对不上。
 * （与移动端 packages/core/src/state/featured.ts 保持一致。）
 */

/** 精选主题池 —— 每一项都是网易云 `/api/playlist/catalogue` 里真实存在的分类名 */
export const FEATURED_CATEGORIES = [
  '华语',
  '欧美',
  '粤语',
  '日语',
  '韩语',
  '流行',
  '摇滚',
  '民谣',
  '电子',
  '说唱',
  '轻音乐',
  'ACG',
] as const

const MS_PER_DAY = 86_400_000

export interface DailyFeatured {
  /** 当天主题分类名（直接用作 getCategoryPlaylists 的 cat 参数） */
  category: string
  /** 当天主题展示名（如「华语精选」），用于分区副标题 */
  theme: string
  /** 当天在主题池里的下标（0..N-1），便于测试与调试 */
  index: number
}

export function dailyFeatured(now: number): DailyFeatured {
  const dayIndex = Math.floor(now / MS_PER_DAY)
  const index =
    ((dayIndex % FEATURED_CATEGORIES.length) + FEATURED_CATEGORIES.length) %
    FEATURED_CATEGORIES.length
  const category = FEATURED_CATEGORIES[index] as string
  return { category, theme: `${category}精选`, index }
}
