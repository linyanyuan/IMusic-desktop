/**
 * 专注模式 —— 对应 Flutter DesktopFocusScreen：
 * 全幅沉浸页：左侧大封面，右侧大字号歌词（活动行放大 + accent 高亮，自动滚到约 1/3 处）。
 * 由播控栏的专注按钮进入/退出（router.toggleFocus 记住来源路由）。
 */

import { useEffect, useMemo, useRef } from 'react'
import { Minimize2, Music4 } from 'lucide-react'
import { Cover } from '../components/Cover'
import { usePlayer, usePlayerTime } from '../contexts/PlayerContext'
import { useSettings } from '../state/hooks'
import { activeLyricIndex, parseLyrics, plainLyricLines } from '../state/lyrics'
import { songCover, toSong } from '../state/songUtils'
import { argbToCss } from '../state/color'
import { useRoute } from '../state/route'

export function FocusView() {
  const player = usePlayer()
  // 专注页的滚动高亮同样只需要进度值（不订阅整个 context，避免多余重渲染）
  const time = usePlayerTime()
  const route = useRoute()
  const snapshot = useSettings().getSnapshot()

  const song = player.currentSong != null ? toSong(player.currentSong) : null
  const lines = useMemo(() => parseLyrics(player.lyrics), [player.lyrics])
  const plain = useMemo(() => plainLyricLines(player.lyrics), [player.lyrics])
  const active = lines.length > 0 ? activeLyricIndex(lines, time.currentTime) : -1

  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  // 活动行滚到容器 1/3 处（比抽屉更靠上，留出下方视野）
  useEffect(() => {
    const container = scrollRef.current
    const el = activeRef.current
    if (container == null || el == null) return
    const top = el.offsetTop - container.clientHeight / 3 + el.clientHeight / 2
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [active])

  const accent = argbToCss(snapshot.lyricsColorValue)
  const lyricSize = Math.max(24, snapshot.lyricsFontSize + 8)

  if (song == null) {
    return (
      <div
        data-testid="focus-view"
        className="flex h-full flex-col items-center justify-center gap-3 text-[#86868B]"
      >
        <Music4 size={40} strokeWidth={1.25} />
        <p className="text-[14px]">还没有在播放的歌曲 —— 先挑一首歌，再进入专注模式</p>
        <button
          type="button"
          onClick={route.toggleFocus}
          className="mt-1 rounded-full bg-[#F5F5F7] px-4 py-2 text-[13px] text-[#86868B] transition-colors hover:bg-black/[0.07]"
        >
          退出专注
        </button>
      </div>
    )
  }

  const cover = songCover(song)

  return (
    <div data-testid="focus-view" className="relative h-full overflow-hidden">
      {/* 背景：封面磨砂放大 */}
      {cover != null && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 scale-125 bg-cover bg-center opacity-[0.18] blur-3xl"
          style={{ backgroundImage: `url(${cover})` }}
        />
      )}

      <div className="relative flex h-full items-center gap-16 px-16">
        {/* 左：封面 + 曲目信息 */}
        <div className="flex w-[38%] max-w-[420px] shrink-0 flex-col items-center">
          <Cover
            testid="focus-cover"
            src={cover}
            size={340}
            radius="rounded-3xl"
            iconSize={72}
            className="shadow-[0_28px_70px_rgba(0,0,0,0.28)]"
          />
          <div className="mt-8 max-w-full text-center">
            <div className="truncate text-[26px] font-bold tracking-tight text-[#1D1D1F]" title={song.title}>
              {song.title}
            </div>
            <div className="mt-2 truncate text-[15px] text-[#86868B]" title={song.artist}>
              {song.artist}
            </div>
            <div className="mt-1 truncate text-[12.5px] text-[#A1A1A6]">
              {song.extra['album']?.toString() ?? ''}
            </div>
          </div>
        </div>

        {/* 右：大字号歌词 */}
        <div className="relative min-w-0 flex-1">
          <div
            ref={scrollRef}
            data-testid="focus-lyrics"
            className="h-[calc(100vh-220px)] overflow-y-auto py-[35vh] pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {player.lyrics.trim() === '' ? (
              <p className="text-[15px] text-[#86868B]">暂无歌词</p>
            ) : lines.length > 0 ? (
              <div className="flex flex-col gap-1.5">
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
                      style={{
                        fontSize: isActive ? lyricSize : Math.round(lyricSize * 0.78),
                        color: isActive ? accent : undefined,
                      }}
                      className={`shrink-0 whitespace-pre-line rounded-xl px-3 py-2 text-left leading-[1.45] transition-all duration-300 ${
                        isActive
                          ? 'font-bold'
                          : 'text-[#86868B]/70 hover:bg-black/[0.03] hover:text-[#1D1D1F]'
                      }`}
                    >
                      {line.text === '' ? '♪' : line.text}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="whitespace-pre-line text-[17px] leading-9 text-[#1D1D1F]/85">
                {plain.join('\n')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 退出 */}
      <button
        type="button"
        data-testid="focus-exit"
        onClick={route.toggleFocus}
        className="absolute right-8 top-6 flex items-center gap-2 rounded-full bg-white/70 px-3.5 py-2 text-[12.5px] text-[#86868B] shadow-[0_4px_14px_rgba(0,0,0,0.06)] backdrop-blur transition-colors hover:text-[#1D1D1F]"
      >
        <Minimize2 size={14} strokeWidth={1.75} />
        退出专注
      </button>
    </div>
  )
}
