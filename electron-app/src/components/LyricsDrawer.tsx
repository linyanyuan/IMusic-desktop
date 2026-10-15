/**
 * 歌词抽屉 —— 行级高亮（卡拉 OK）+ 自动居中滚动 + 点击行跳转进度。
 * 无时间戳的纯文本歌词退化为普通排版；字号/颜色读设置页（改动即时生效）。
 */

import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { usePlayer, usePlayerTime } from '../contexts/PlayerContext'
import { useSettings } from '../state/hooks'
import { activeLyricIndex, parseLyrics, plainLyricLines } from '../state/lyrics'
import { argbToCss } from '../state/color'
import { toSong } from '../state/songUtils'

export function LyricsDrawer({ onClose }: { onClose: () => void }) {
  const player = usePlayer()
  // 歌词高亮跟着播放进度走 —— 只有这些地方需要每 250ms 重渲染
  const time = usePlayerTime()
  const settings = useSettings()
  const snapshot = settings.getSnapshot()

  const lines = useMemo(() => parseLyrics(player.lyrics), [player.lyrics])
  const plain = useMemo(() => plainLyricLines(player.lyrics), [player.lyrics])
  const active = lines.length > 0 ? activeLyricIndex(lines, time.currentTime) : -1

  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  // 高亮行居中：手算 scrollTop，避免 scrollIntoView 连带滚动外层布局
  useEffect(() => {
    const container = scrollRef.current
    const el = activeRef.current
    if (container == null || el == null) return
    const top = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [active])

  const song = player.currentSong != null ? toSong(player.currentSong) : null
  const accent = argbToCss(snapshot.lyricsColorValue)
  const fontSize = snapshot.lyricsFontSize

  // 用 if/else 先选分支，避免 JSX 里的嵌套三元（项目约定禁用）
  let body: ReactNode
  if (player.lyrics.trim() === '') {
    body = <p className="text-[13px] text-[#86868B]">暂无歌词</p>
  } else if (lines.length > 0) {
    body = (
      <div className="flex flex-col gap-1 pb-24 pt-24">
        {lines.map((line, i) => {
          const isActive = i === active
          return (
            <button
              key={`${line.time}-${i}`}
              ref={isActive ? activeRef : null}
              type="button"
              data-lyric-line={i}
              data-lyric-time={line.time}
              data-active={isActive ? 'true' : 'false'}
              onClick={() => player.seek(line.time)}
              style={{ fontSize, color: isActive ? accent : undefined }}
              className={`shrink-0 whitespace-pre-line rounded-lg px-2 py-1.5 text-left leading-[1.5] transition-all duration-200 ${
                isActive
                  ? 'font-semibold'
                  : 'text-[#86868B] hover:bg-black/[0.03] hover:text-[#1D1D1F]'
              }`}
            >
              {line.text === '' ? '♪' : line.text}
            </button>
          )
        })}
      </div>
    )
  } else {
    body = (
      <div className="whitespace-pre-line text-[13.5px] leading-7 text-[#1D1D1F]">
        {plain.join('\n')}
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-[#E5E5EA]/70 px-5 py-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-[#1D1D1F]">歌词</h3>
          {song != null && (
            <p className="truncate text-[11.5px] text-[#86868B]">
              {song.title} · {song.artist}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="关闭抽屉"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#86868B] hover:bg-black/5"
        >
          <X size={15} strokeWidth={1.75} />
        </button>
      </div>

      <div ref={scrollRef} className="relative h-[calc(100%-53px)] overflow-y-auto px-5 py-6">
        {body}
      </div>

      {lines.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] text-[#86868B]">
          点击歌词行可跳转进度
        </div>
      )}
    </>
  )
}
