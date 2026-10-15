/**
 * 音乐口味分类多选 chips —— 首页首次引导卡 / 「调整口味」弹窗 / 设置页共用。
 *
 * 上限 MAX_TASTE_GENRES：选中数达到上限后未选中的 chip 变为禁用（而不是静默忽略点击），
 * 让「为什么点不动」有可见反馈。
 */

import { MAX_TASTE_GENRES, GENRES } from '../state/genres'

export function TasteGenreChips({
  selected,
  onChange,
  max = MAX_TASTE_GENRES,
  disabled = false,
}: {
  selected: string[]
  onChange: (next: string[]) => void
  max?: number
  disabled?: boolean
}) {
  const atLimit = selected.length >= max

  const toggle = (key: string) => {
    if (disabled) return
    if (selected.includes(key)) {
      onChange(selected.filter((item) => item !== key))
      return
    }
    if (atLimit) return
    onChange([...selected, key])
  }

  return (
    <div className="flex flex-wrap gap-2" data-testid="taste-genre-chips">
      {GENRES.map((genre) => {
        const active = selected.includes(genre.key)
        return (
          <button
            key={genre.key}
            type="button"
            data-genre-key={genre.key}
            data-active={active ? 'true' : 'false'}
            aria-pressed={active}
            disabled={disabled || (!active && atLimit)}
            onClick={() => toggle(genre.key)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors disabled:opacity-40 ${
              active
                ? 'bg-[#FA233B] font-medium text-white'
                : 'bg-[#F5F5F7] text-[#1D1D1F] hover:bg-black/[0.07]'
            }`}
          >
            {genre.label}
          </button>
        )
      })}
    </div>
  )
}
