/**
 * 底部磨砂播控栏（h-76，三栏对称）—— 当前曲目 / 播控台+进度 / 辅助控制
 * 右侧可滑出歌词与播放队列抽屉。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Heart,
  Shuffle,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Repeat,
  Repeat1,
  Volume2,
  Volume1,
  VolumeX,
  ListMusic,
  Mic2,
  Maximize2,
  Minimize2,
  MonitorSmartphone,
} from 'lucide-react'
import { Cover } from './Cover'
import { LyricsDrawer } from './LyricsDrawer'
import { QueueDrawer } from './QueueDrawer'
import { usePlayer, usePlayerTime } from '../contexts/PlayerContext'
import { useLibrary } from '../state/hooks'
import { DeskRoute, useRoute } from '../state/route'
import { PlayMode } from '../services/models'
import { songCover, formatTime, toSong } from '../state/songUtils'

/** 通用滑块（进度/音量共用）—— 默认 3px，悬浮 6px */
function Slider({
  value,
  max,
  onSeek,
  ariaLabel,
  width = '100%',
}: {
  value: number
  max: number
  onSeek: (v: number) => void
  ariaLabel: string
  width?: string | number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(false)
  const [dragging, setDragging] = useState(false)
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  const active = hover || dragging

  const seek = useCallback(
    (clientX: number) => {
      const el = ref.current
      if (el == null || max <= 0) return
      const rect = el.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      onSeek(ratio * max)
    },
    [max, onSeek],
  )

  // 鼠标在滑块外松开时也要结束拖拽，否则 dragging 卡在 true，
  // 之后鼠标经过就会继续 seek（用户反馈的「拖完还跟着跑」）
  useEffect(() => {
    if (!dragging) return
    const stop = () => setDragging(false)
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [dragging])

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      style={{ width }}
      className="group relative flex cursor-pointer items-center py-2"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseDown={(e) => {
        setDragging(true)
        seek(e.clientX)
      }}
      onMouseUp={() => setDragging(false)}
      onMouseMove={(e) => {
        if (dragging) seek(e.clientX)
      }}
    >
      {/* 轨道高度恒定 3px，hover 用 scaleY 视觉放大 —— transform 不参与布局，
          否则上方播控按钮会被顶上去 3px（用户反馈的跳动） */}
      <div
        className={`h-[3px] w-full origin-center overflow-hidden rounded-full bg-hover transition-transform duration-150 ${active ? 'scale-y-[2]' : ''}`}
      >
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* 滑块保持白色：它压在红色进度条上，两种主题下都应是白点 */}
      <div
        className={`absolute h-3 w-3 -translate-x-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.3)] transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}
        style={{ left: `${pct}%` }}
      />
    </div>
  )
}

function PlayModeIcon({ mode }: { mode: PlayMode }) {
  if (mode === PlayMode.Single) return <Repeat1 size={17} strokeWidth={1.75} />
  if (mode === PlayMode.Shuffle) return <Shuffle size={17} strokeWidth={1.75} />
  return <Repeat size={17} strokeWidth={1.75} />
}

export function PlayerBar({
  drawer,
  onDrawerChange,
}: {
  drawer: 'lyrics' | 'queue' | null
  onDrawerChange: (drawer: 'lyrics' | 'queue' | null) => void
}) {
  const player = usePlayer()
  // 进度单独订阅：播控栏是每 250ms 都要跟着动的，列表则不用
  const time = usePlayerTime()
  const library = useLibrary()
  const route = useRoute()

  // 独立桌面歌词窗口的开启状态（按钮高亮；热键开关时也要同步）
  const [desktopLyricsOpen, setDesktopLyricsOpen] = useState(false)
  useEffect(() => {
    const api = window.imusicAPI
    if (api?.onLyricsToggled == null) return
    void api.lyricsIsOpen?.().then(setDesktopLyricsOpen).catch(() => {})
    return api.onLyricsToggled(setDesktopLyricsOpen)
  }, [])

  const song = player.currentSong
  const songModel = song != null ? toSong(song) : null
  // 用身份比较（library.isLiked）：同一首歌的 id 在收藏后可能带 :pN 分P后缀，
  // 严格 id 相等会误判为「未收藏」
  const liked = songModel != null && library.isLiked(songModel)

  const VolumeIcon =
    player.isMuted || player.volume === 0 ? VolumeX : player.volume < 0.5 ? Volume1 : Volume2

  return (
    <>
      {/* 抽屉 */}
      {drawer != null && (
        <div className="fixed bottom-[76px] right-0 top-[38px] z-40 w-[340px] overflow-hidden rounded-tl-2xl border-l border-subtle bg-card/85 shadow-[-8px_0_28px_rgba(0,0,0,0.06)] backdrop-blur-2xl">
          <div className="relative h-full">
            {drawer === 'lyrics' ? (
              <LyricsDrawer onClose={() => onDrawerChange(null)} />
            ) : (
              <QueueDrawer onClose={() => onDrawerChange(null)} />
            )}
          </div>
        </div>
      )}

      <footer className="relative z-50 grid h-[76px] shrink-0 grid-cols-3 items-center border-t border-subtle bg-playerbar-bg px-6 backdrop-blur-2xl">
        {/* 左：当前曲目（点封面进专注模式，再点退出 —— 对应 Flutter 播控栏封面手势） */}
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            data-testid="cover-focus-toggle"
            aria-label={route.route === DeskRoute.Focus ? '退出专注模式' : '进入专注模式'}
            title={route.route === DeskRoute.Focus ? '退出专注模式' : '进入专注模式'}
            onClick={route.toggleFocus}
            disabled={songModel == null}
            className="shrink-0 rounded-lg transition-transform enabled:hover:scale-[1.04] enabled:active:scale-95 disabled:opacity-60"
          >
            <Cover
              src={songModel != null ? songCover(songModel) : null}
              size={50}
              radius="rounded-lg"
              iconSize={18}
              className={player.isPlaying ? 'animate-[pulse_3s_ease-in-out_infinite]' : ''}
            />
          </button>
          <div className="min-w-0 max-w-[240px]">
            {/* 定宽上限：长标题在这里截断，红心位置不随曲名长度漂移 */}
            <div className="truncate text-[13.5px] font-medium text-primary">
              {songModel?.title ?? '未在播放'}
            </div>
            <div className="truncate text-[12px] text-secondary">
              {songModel?.artist ?? '选择一首歌开始'}
            </div>
          </div>
          {songModel != null && (
            <button
              type="button"
              aria-label={liked ? '取消喜欢' : '喜欢'}
              onClick={() => void library.toggleLike(songModel)}
              className={`ml-1 shrink-0 transition-transform active:scale-90 ${
                liked ? 'text-accent' : 'text-secondary hover:text-primary'
              }`}
            >
              <Heart size={16} strokeWidth={1.75} fill={liked ? 'currentColor' : 'none'} />
            </button>
          )}
        </div>

        {/* 中：播控 + 进度 */}
        <div className="flex flex-col items-center gap-0.5">
          {player.error != null && (
            <div className="mb-0.5 truncate text-[11.5px] text-accent">{player.error}</div>
          )}
          <div className="flex items-center gap-5">
            <button
              type="button"
              aria-label="播放模式"
              onClick={() => player.cyclePlayMode()}
              className={`transition-colors ${
                player.playMode === PlayMode.List
                  ? 'text-secondary hover:text-primary'
                  : 'text-accent'
              }`}
            >
              <PlayModeIcon mode={player.playMode} />
            </button>
            <button
              type="button"
              aria-label="上一首"
              onClick={() => player.prev()}
              className="text-primary transition-colors hover:text-accent"
            >
              <SkipBack size={19} strokeWidth={1.75} fill="currentColor" />
            </button>
            <button
              type="button"
              aria-label={player.isPlaying ? '暂停' : '播放'}
              onClick={() => player.togglePlay()}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white shadow-[0_4px_14px_rgba(250,35,59,0.35)] transition-transform hover:bg-accent-hover active:scale-95"
            >
              {player.isPlaying ? (
                <Pause size={17} strokeWidth={2} fill="currentColor" />
              ) : (
                <Play size={17} strokeWidth={2} fill="currentColor" className="ml-[1px]" />
              )}
            </button>
            <button
              type="button"
              aria-label="下一首"
              onClick={() => player.next()}
              className="text-primary transition-colors hover:text-accent"
            >
              <SkipForward size={19} strokeWidth={1.75} fill="currentColor" />
            </button>
          </div>
          <div className="flex w-full max-w-[520px] items-center gap-3">
            <span className="w-9 text-right text-[11.5px] tabular-nums text-secondary">
              {formatTime(time.currentTime)}
            </span>
            <Slider
              value={time.currentTime}
              max={time.duration}
              onSeek={(v) => player.seek(v)}
              ariaLabel="播放进度"
            />
            <span className="w-9 text-[11.5px] tabular-nums text-secondary">
              {formatTime(time.duration)}
            </span>
          </div>
        </div>

        {/* 右：专注/歌词/队列/音量 */}
        <div className="flex items-center justify-end gap-4">
          <button
            type="button"
            data-testid="focus-toggle"
            aria-label={route.route === DeskRoute.Focus ? '退出专注模式' : '专注模式'}
            aria-pressed={route.route === DeskRoute.Focus}
            onClick={route.toggleFocus}
            className={`transition-colors ${
              route.route === DeskRoute.Focus
                ? 'text-accent'
                : 'text-secondary hover:text-primary'
            }`}
          >
            {route.route === DeskRoute.Focus ? (
              <Minimize2 size={17} strokeWidth={1.75} />
            ) : (
              <Maximize2 size={17} strokeWidth={1.75} />
            )}
          </button>
          <button
            type="button"
            aria-label="歌词"
            onClick={() => onDrawerChange(drawer === 'lyrics' ? null : 'lyrics')}
            className={`transition-colors ${drawer === 'lyrics' ? 'text-accent' : 'text-secondary hover:text-primary'}`}
          >
            <Mic2 size={17} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            data-testid="desktop-lyrics-toggle"
            aria-label="桌面歌词"
            aria-pressed={desktopLyricsOpen}
            title="独立桌面歌词窗口（Ctrl+Alt+D）"
            onClick={() => {
              void window.imusicAPI?.lyricsToggle().then((open) => setDesktopLyricsOpen(open))
            }}
            className={`transition-colors ${desktopLyricsOpen ? 'text-accent' : 'text-secondary hover:text-primary'}`}
          >
            <MonitorSmartphone size={17} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="播放队列"
            onClick={() => onDrawerChange(drawer === 'queue' ? null : 'queue')}
            className={`transition-colors ${drawer === 'queue' ? 'text-accent' : 'text-secondary hover:text-primary'}`}
          >
            <ListMusic size={17} strokeWidth={1.75} />
          </button>
          <div className="flex w-[110px] items-center gap-2">
            <button
              type="button"
              aria-label="静音"
              onClick={player.toggleMute}
              className="text-secondary transition-colors hover:text-primary"
            >
              <VolumeIcon size={16} strokeWidth={1.75} />
            </button>
            <Slider
              value={player.isMuted ? 0 : player.volume}
              max={1}
              ariaLabel="音量"
              onSeek={(v) => player.setVolume(v)}
            />
          </div>
        </div>
      </footer>
    </>
  )
}
