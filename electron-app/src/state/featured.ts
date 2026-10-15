/**
 * 首页「今日精选」的概念定义 —— 回答「何为精选」：
 *
 * 精选 ≠ 推荐 feed 的前两条（M8 之前的做法：recommended.slice(0, 2)，
 * 没有独立含义，还和推荐歌曲区内容重复，卡片上还挂着名不副实的
 * 「FEATURED PLAYLIST」标签 —— 其实是单曲）。
 *
 * 今日精选 = **以日期为种子的编辑精选歌单**：
 * - 从热门歌单主题池里按「今天」挑一个主题（华语经典 / 粤语经典 / …），
 *   取该主题批次的前 2 个合集做成大 hero 卡
 * - 当天固定（反复进首页不变），次日自动换主题 —— 有「今日」的真实含义
 * - 点击进歌单详情，hover 的播放键直接整单播放
 *
 * 种子用 UTC 天数（Date.now / 86400000）取模主题数，无需任何外部编辑数据源。
 */

import { hotPlaylistQueryForBatch } from '../services/bilibili'

const MS_PER_DAY = 86_400_000
const THEMES_PER_CYCLE = 10

export interface DailyFeatured {
  /** 热门歌单批次（offset = batch * pageSize） */
  batch: number
  /** 当天主题名（如「华语经典合集」），用于分区副标题 */
  theme: string
}

export function dailyFeatured(now: number): DailyFeatured {
  const dayIndex = Math.floor(now / MS_PER_DAY)
  const batch = ((dayIndex % THEMES_PER_CYCLE) + THEMES_PER_CYCLE) % THEMES_PER_CYCLE
  return { batch, theme: hotPlaylistQueryForBatch(batch).keyword }
}
