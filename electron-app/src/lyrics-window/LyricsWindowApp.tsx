/**
 * 独立桌面歌词窗口的渲染端 —— 对照 Flutter lyrics_window_app.dart 的设计：
 *
 * - **全透明**：无底色药丸，歌词文本直接浮在桌面上（靠文字阴影保证可读性）
 * - **悬停工具条**（顶部居中，140ms 淡入）：喜欢 / 上一首 / 播放暂停 / 下一首 / 锁定 / 关闭
 * - **锁定位置**：锁定后禁止拖动（窗口仍保持置顶）
 * - **歌词样式同步设置页**：字号（默认 22）+ 高亮颜色（默认 #1ED760）随设置即时变
 * - 当前行（设置色，800 粗）+ 下一行预览（白 88%，fontSize-3）
 * - 状态：无歌词 →「暂无歌词」；换行有 160ms 淡入过渡
 * - 整窗可拖（锁定时禁用；按钮 no-drag）
 *
 * 这是一个完全独立的轻量应用（main.tsx 按 `#/lyrics-window` 分流）：不挂
 * PlayerProvider，所有状态来自主窗口经主进程转发的 DesktopLyricsState，
 * 控制按钮经 IPC 回发命令给主窗口执行。
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  Heart,
  Lock,
  LockOpen,
} from 'lucide-react'
import { activeLyricIndex, parseLyrics, plainLyricLines, type LyricLine } from '../state/lyrics'
import { argbToCss } from '../state/color'

const DEFAULT_STATE: DesktopLyricsState = {
  song: null,
  lyrics: '',
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  fontSize: 22,
  colorValue: 0xff1ed760,
  isFavorite: false,
  canFavorite: false,
}

/** 当前行文本：无歌词 / 有时间戳 / 纯文本三种回退。抽成函数避免嵌套三元 */
function currentLyricText(
  hasLyrics: boolean,
  lines: LyricLine[],
  active: number,
  plain: string[],
): string {
  if (!hasLyrics) return '暂无歌词'
  if (lines.length > 0) {
    if (active >= 0) return lines[active].text
    return lines[0]?.text ?? ''
  }
  return plain[0] ?? '暂无歌词'
}

const TEXT_SHADOW =
  '0 1px 5px rgba(0,0,0,0.7), 0 2px 14px rgba(0,0,0,0.42)'

export function LyricsWindowApp() {
  const [state, setState] = useState<DesktopLyricsState>(DEFAULT_STATE)
  // 锁定是窗口本地 UI 状态，不接受主窗口同步覆盖（与 Flutter 一致）
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    const api = window.imusicAPI
    if (api?.onLyricsState == null) return
    return api.onLyricsState(setState)
  }, [])

  const lines = useMemo(() => parseLyrics(state.lyrics), [state.lyrics])
  const plain = useMemo(() => plainLyricLines(state.lyrics), [state.lyrics])
  const active = lines.length > 0 ? activeLyricIndex(lines, state.currentTime) : -1

  const trimmed = state.lyrics.trim()
  const hasLyrics = trimmed !== ''
  const currentText = currentLyricText(hasLyrics, lines, active, plain)
  const nextText =
    hasLyrics && lines.length > 0 && active >= 0 ? (lines[active + 1]?.text ?? null) : null

  const lyricColor = argbToCss(state.colorValue)
  const fontSize = state.fontSize
  const nextFontSize = Math.max(15, Math.min(30, fontSize - 3))

  const send = (command: DesktopLyricsCommand): void => {
    window.imusicAPI?.lyricsSendCommand(command)
  }
  const close = (): void => {
    void window.imusicAPI?.lyricsToggle().catch(() => {})
  }

  return (
    <div
      className={`lyrics-window-root group relative h-screen w-screen ${locked ? 'lyrics-locked' : ''}`}
    >
      {/* 歌词文本：整窗居中，上下留出工具条空间（对应 Flutter 的 padding: 42/16） */}
      <div className="flex h-full w-full flex-col items-center justify-center px-5 pb-4 pt-11">
        <div
          data-lyric-current
          key={`${currentText}-${nextText ?? ''}`}
          className="lyrics-line-swap max-w-full truncate text-center font-extrabold leading-tight"
          style={{
            color: hasLyrics ? lyricColor : 'rgba(255,255,255,0.92)',
            fontSize,
            textShadow: TEXT_SHADOW,
          }}
        >
          {currentText}
        </div>
        {nextText != null && (
          <div
            data-lyric-next
            className="mt-2 max-w-full truncate text-center font-bold leading-tight text-white/85"
            style={{ fontSize: nextFontSize, textShadow: TEXT_SHADOW }}
          >
            {nextText}
          </div>
        )}
      </div>

      {/* 悬停工具条（顶部居中；对应 Flutter _Toolbar：半透明黑底圆角） */}
      <div className="pointer-events-none absolute inset-x-0 top-1.5 flex justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <div className="lyrics-no-drag pointer-events-auto flex items-center gap-0.5 rounded-lg border border-white/10 bg-black/45 px-2 py-1 backdrop-blur-md">
          <button
            type="button"
            aria-label={state.isFavorite ? '取消喜欢' : '喜欢'}
            disabled={!state.canFavorite}
            onClick={() => send('toggleFavorite')}
            className="rounded-full p-1.5 transition-colors enabled:hover:bg-white/15 disabled:opacity-35"
          >
            <Heart
              size={15}
              strokeWidth={2}
              fill={state.isFavorite ? 'currentColor' : 'none'}
              className={state.isFavorite ? 'text-[#FF4D6D]' : 'text-white'}
            />
          </button>
          <span className="h-4 w-px bg-white/10" />
          <button
            type="button"
            aria-label="上一首"
            onClick={() => send('prev')}
            className="rounded-full p-1.5 text-white transition-colors hover:bg-white/15"
          >
            <SkipBack size={15} strokeWidth={2} fill="currentColor" />
          </button>
          <button
            type="button"
            aria-label={state.isPlaying ? '暂停' : '播放'}
            onClick={() => send('togglePlay')}
            className="rounded-full p-1.5 text-white transition-colors hover:bg-white/15"
          >
            {state.isPlaying ? (
              <Pause size={16} strokeWidth={2} fill="currentColor" />
            ) : (
              <Play size={16} strokeWidth={2} fill="currentColor" className="ml-[1px]" />
            )}
          </button>
          <button
            type="button"
            aria-label="下一首"
            onClick={() => send('next')}
            className="rounded-full p-1.5 text-white transition-colors hover:bg-white/15"
          >
            <SkipForward size={15} strokeWidth={2} fill="currentColor" />
          </button>
          <span className="h-4 w-px bg-white/10" />
          <button
            type="button"
            data-testid="lyrics-lock"
            aria-label={locked ? '解锁拖动' : '锁定位置'}
            aria-pressed={locked}
            onClick={() => setLocked((v) => !v)}
            className="rounded-full p-1.5 text-white transition-colors hover:bg-white/15"
          >
            {locked ? <Lock size={15} strokeWidth={2} /> : <LockOpen size={15} strokeWidth={2} />}
          </button>
          <button
            type="button"
            aria-label="关闭"
            onClick={close}
            className="rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )
}
