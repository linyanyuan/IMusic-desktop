/**
 * 分类（流派）定义 —— 搜索页「热门分类浏览」、分类详情页与「音乐口味」推荐共用。
 *
 * `neteaseCat` 必须是网易云 `/api/playlist/catalogue` 里真实存在的分类名
 * （2026-10 实测 70 个）；写不存在的名字接口会返回空列表，表现为「分类里什么都没有」。
 * 因此 UI 上的中文标签可以与 neteaseCat 不同（如「专注纯音乐」→ 轻音乐）。
 */

export interface Genre {
  /** 稳定 key（存储与路由参数用它，不要用中文标签当 key） */
  key: string
  /** UI 标签 */
  label: string
  /** 网易云分类目录里的真实名字 */
  neteaseCat: string
  /** 分类卡渐变起止色 */
  from: string
  to: string
}

export const GENRES: Genre[] = [
  { key: 'pop', label: '流行', neteaseCat: '流行', from: '#FA233B', to: '#FF7A59' },
  { key: 'chinese', label: '华语', neteaseCat: '华语', from: '#FF375F', to: '#FFB340' },
  { key: 'western', label: '欧美', neteaseCat: '欧美', from: '#5E5CE6', to: '#64D2FF' },
  { key: 'cantonese', label: '粤语', neteaseCat: '粤语', from: '#0A84FF', to: '#30D158' },
  { key: 'japanese', label: '日语', neteaseCat: '日语', from: '#FF2D55', to: '#BF5AF2' },
  { key: 'korean', label: '韩语', neteaseCat: '韩语', from: '#FF2D55', to: '#FF9F0A' },
  { key: 'rock', label: '摇滚', neteaseCat: '摇滚', from: '#5E5CE6', to: '#BF5AF2' },
  { key: 'electronic', label: '电子', neteaseCat: '电子', from: '#30D158', to: '#66D4CF' },
  { key: 'classical', label: '古典', neteaseCat: '古典', from: '#8E8E93', to: '#48484A' },
  { key: 'folk', label: '民谣', neteaseCat: '民谣', from: '#FF9F0A', to: '#FFD60A' },
  { key: 'rap', label: '说唱', neteaseCat: '说唱', from: '#48484A', to: '#1D1D1F' },
  { key: 'jazz', label: '爵士', neteaseCat: '爵士', from: '#C77800', to: '#FFD60A' },
  { key: 'rnb', label: 'R&B/Soul', neteaseCat: 'R&B/Soul', from: '#AF52DE', to: '#FF2D55' },
  { key: 'ancient', label: '古风', neteaseCat: '古风', from: '#1D9E5F', to: '#66D4CF' },
  { key: 'acg', label: 'ACG', neteaseCat: 'ACG', from: '#FF7A59', to: '#FFD60A' },
  { key: 'healing', label: '治愈', neteaseCat: '治愈', from: '#64D2FF', to: '#BF5AF2' },
  // 「专注纯音乐」在网易分类里没有同名项，映射到最接近的「轻音乐」
  { key: 'focus', label: '专注纯音乐', neteaseCat: '轻音乐', from: '#0A84FF', to: '#64D2FF' },
]

/** 口味偏好最多可选几个分类 */
export const MAX_TASTE_GENRES = 5

const GENRE_BY_KEY = new Map(GENRES.map((genre) => [genre.key, genre]))

export function genreByKey(key: string): Genre | undefined {
  return GENRE_BY_KEY.get(key)
}

export function genreLabel(key: string): string {
  return GENRE_BY_KEY.get(key)?.label ?? key
}

/**
 * genre key 列表 → 真实存在的网易云分类名（去重、丢弃未知 key、保持顺序）。
 * 未知 key 直接丢弃，避免存储里的历史 key 让接口拿到空分类。
 */
export function neteaseCatsForGenreKeys(keys: string[]): string[] {
  const cats: string[] = []
  for (const key of keys) {
    const cat = GENRE_BY_KEY.get(key)?.neteaseCat
    if (cat != null && !cats.includes(cat)) cats.push(cat)
  }
  return cats
}

/** 只保留已知的 genre key（去重、保持顺序） */
export function normalizeGenreKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) return []
  const result: string[] = []
  for (const key of keys) {
    const text = String(key ?? '').trim()
    if (text === '' || result.includes(text) || !GENRE_BY_KEY.has(text)) continue
    result.push(text)
    if (result.length >= MAX_TASTE_GENRES) break
  }
  return result
}
