/**
 * 播放引擎 —— 移植 BiliMusic PlayerContext 的抗抖动设计：
 * - 单例 HTMLAudioElement + AbortController source 生命周期（晚到结果不得生效）
 * - error 立即 recover；stalled/waiting 12s 看门狗 → recover（每首歌最多 2 次，续播进度）
 * - waitForMetadata 20s 超时；play() 12s 超时（CDN 挂死时 play() 会永远 pending）
 * - 切歌/暂停 150ms smoothstep 音量斜坡防爆音
 * - >15min 长音频断点记忆（localStorage，容量 200，LRU）
 * - B 站等 headers 非空的 URL 直接流播（主进程 session 已注入 Referer，见 electron/headers.ts）
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { RawSong } from '../services/musicProvider'
import { PlayMode } from '../services/models'
import { getServices } from '../services/runtime'

// ---------------- 断点记忆 ----------------

const BOOKMARK_KEY = 'imusic:playBookmarks'
const BOOKMARK_MIN_DURATION = 15 * 60 // >15min 才记忆
const BOOKMARK_CAPACITY = 200
const BOOKMARK_SAVE_INTERVAL_MS = 5000

type BookmarkMap = Record<string, { position: number; updatedAt: number }>

function loadBookmarks(): BookmarkMap {
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY)
    return raw ? (JSON.parse(raw) as BookmarkMap) : {}
  } catch {
    return {}
  }
}

function readBookmark(songId: string): number {
  return loadBookmarks()[songId]?.position ?? 0
}

function writeBookmark(songId: string, position: number): void {
  const map = loadBookmarks()
  map[songId] = { position, updatedAt: Date.now() }
  // LRU 裁剪
  const entries = Object.entries(map).sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  const trimmed = Object.fromEntries(entries.slice(0, BOOKMARK_CAPACITY))
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(trimmed))
  } catch {
    /* 存储满等异常忽略 */
  }
}

function clearBookmark(songId: string): void {
  const map = loadBookmarks()
  if (!(songId in map)) return
  delete map[songId]
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

// ---------------- 音量斜坡（150ms smoothstep） ----------------

// 坑：requestAnimationFrame 只跟着「可见的」页面走。窗口最小化 / 被遮挡 /
// 切到别的 Space 时，Chromium 会停发 rAF —— tick 再也不执行，斜坡永远到不了终点，
// done() 不被调用，fadeVolume 后面那句 startSource(song, bookmark) 就永不执行：
// 表现为「最小化时用全局热键切歌毫无反应」（footer 歌名变了，audio.src 一直是空、
// 进度停在 0:00）。所以除了 rAF 之外必须挂一个挂钟兜底定时器强制收尾。
const FADE_MS = 150

function fadeVolume(
  audio: HTMLAudioElement,
  from: number,
  to: number,
  durationMs: number,
  done: () => void,
): () => void {
  if (durationMs <= 0 || from === to) {
    audio.volume = to
    done()
    return () => {}
  }
  const start = performance.now()
  let raf = 0
  let timer = 0
  // rAF 的 tick 到点、兜底定时器到点、外部 cancel 三者会竞争，用 finished 保证收尾恰好一次
  let finished = false

  const finish = () => {
    if (finished) return
    finished = true
    if (raf) cancelAnimationFrame(raf)
    if (timer) clearTimeout(timer)
    audio.volume = to // 隐藏时直接一步到位，不做斜坡
    done()
  }

  const tick = (now: number) => {
    if (finished) return
    const t = Math.min(1, (now - start) / durationMs)
    const s = t * t * (3 - 2 * t) // smoothstep
    audio.volume = from + (to - from) * s
    if (t < 1) {
      raf = requestAnimationFrame(tick)
    } else {
      finish()
    }
  }

  raf = requestAnimationFrame(tick)
  // 可见时 rAF 先到点；隐藏时 rAF 被停发，由这个定时器兜底收尾
  timer = window.setTimeout(finish, durationMs + 50)

  return () => {
    // 被外部取消（playSong/togglePlay 会先 cancel 上一次斜坡）后不得再触发 done()
    if (finished) return
    finished = true
    if (raf) cancelAnimationFrame(raf)
    if (timer) clearTimeout(timer)
  }
}

// ---------------- 超时工具 ----------------

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms),
    ),
  ])
}

function waitForMetadata(audio: HTMLAudioElement, timeoutMs: number): Promise<void> {
  if (audio.readyState >= 1) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`waitForMetadata timeout (${timeoutMs}ms)`))
    }, timeoutMs)
    const onLoaded = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('audio metadata error'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('error', onError)
    }
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('error', onError)
  })
}

// ---------------- Context ----------------

export interface PlayerState {
  currentSong: RawSong | null
  queue: RawSong[]
  currentIndex: number
  isPlaying: boolean
  isLoading: boolean
  volume: number
  /** 静音（音量保留在 lastVolume，取消静音时恢复） */
  isMuted: boolean
  playMode: PlayMode
  lyrics: string
  error: string | null
}

export interface PlayerActions {
  playSong: (song: RawSong, queue?: RawSong[]) => void
  /** 跳到队列中指定下标（播放队列抽屉用） */
  playAt: (index: number) => void
  togglePlay: () => void
  next: () => void
  prev: () => void
  seek: (seconds: number) => void
  setVolume: (v: number) => void
  /** 音量增减一步（快捷键用，步长 0.08 对齐 Flutter playbackVolumeStep） */
  stepVolume: (delta: number) => void
  toggleMute: () => void
  cyclePlayMode: () => void
}

const PlayerContext = createContext<(PlayerState & PlayerActions) | null>(null)

/**
 * 播放进度单独一条 context —— 刻意的性能分层。
 *
 * `timeupdate` 大约每 250ms 触发一次，如果 currentTime/duration 摆在主 context 里，
 * 那么每次进度推进都会换掉整个 value 对象，所有 usePlayer() 消费者（含几百行的
 * 收藏/歌单/历史列表）都跟着每秒钟重渲染 4 次 —— 只有播控栏、歌词抽屉、专注页
 * 真的需要进度值。拆开后列表只在换歌/播放状态变化时才重渲染。
 */
export interface PlayerTime {
  currentTime: number
  duration: number
}

const PlayerTimeContext = createContext<PlayerTime | null>(null)

const STALL_WATCHDOG_MS = 12000
const MAX_RECOVER_PER_SONG = 2
const METADATA_TIMEOUT_MS = 20000
const PLAY_TIMEOUT_MS = 12000

function songKey(song: RawSong): string {
  return song['id']?.toString() ?? ''
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const sourceCtlRef = useRef<AbortController | null>(null)
  const recoverCountRef = useRef(0)
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeCancelRef = useRef<(() => void) | null>(null)
  const lastBookmarkSaveRef = useRef(0)

  const [currentSong, setCurrentSong] = useState<RawSong | null>(null)
  const [queue, setQueue] = useState<RawSong[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const lastVolumeRef = useRef(1)
  const [playMode, setPlayMode] = useState<PlayMode>(PlayMode.List)
  const [lyrics, setLyrics] = useState('')
  const [error, setError] = useState<string | null>(null)

  // 用 ref 镜像供事件回调读取（避免闭包过期）
  const stateRef = useRef({ currentSong, queue, currentIndex, playMode, volume })
  stateRef.current = { currentSong, queue, currentIndex, playMode, volume }

  const getAudio = useCallback((): HTMLAudioElement => {
    if (audioRef.current == null) {
      audioRef.current = new Audio()
      audioRef.current.preload = 'auto'
    }
    return audioRef.current
  }, [])

  const clearStallWatchdog = useCallback(() => {
    if (stallTimerRef.current != null) {
      clearTimeout(stallTimerRef.current)
      stallTimerRef.current = null
    }
  }, [])

  /** 歌词请求序号 —— 切歌后晚到的歌词结果不得覆盖当前歌曲 */
  const lyricsSerialRef = useRef(0)

  /**
   * 歌词加载（对齐 Dart requestLyricsForCurrentSong）：
   * 取链返回的内联歌词优先，为空则异步补取（B站 CC 字幕 / 合集歌词 / 元数据反查）。
   */
  const loadLyrics = useCallback(async (song: RawSong, inline: string) => {
    const serial = ++lyricsSerialRef.current
    const inlineText = inline.trim()
    if (inlineText !== '') {
      setLyrics(inlineText)
      return
    }
    setLyrics('')
    try {
      const fetched = await getServices().music.getLyrics(song)
      if (lyricsSerialRef.current !== serial) return
      const text = fetched.trim()
      if (text !== '') {
        console.info(`[Player] 歌词异步加载成功: ${text.split('\n').length} 行`)
      }
      setLyrics(text)
    } catch (e) {
      if (lyricsSerialRef.current !== serial) return
      console.warn(`[Player] 歌词加载失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  /** 核心：为某首歌建立播放源。resumeAt>0 表示从该进度续播 */
  const startSource = useCallback(
    async (song: RawSong, resumeAt: number) => {
      const ctl = new AbortController()
      sourceCtlRef.current?.abort()
      sourceCtlRef.current = ctl
      const audio = getAudio()

      setIsLoading(true)
      setError(null)
      try {
        const id = songKey(song)

        // 离线优先：命中本地缓存直接播 imusic-audio://（断网可播、可 seek），跳过取链。
        // 未命中（或纯浏览器预览下没有 imusicAPI）走原来的取链路径，一字不动。
        const hit = (await window.imusicAPI?.cacheLookup(id).catch(() => null)) ?? null
        if (ctl.signal.aborted) return // 晚到的命中检查结果不得生效

        if (hit != null) {
          audio.src = hit.url
          // 命中缓存时没有内联歌词，交给异步补取；离线拉取失败由 loadLyrics 自己兜底，不挡播放
          void loadLyrics(song, '')
        } else {
          const playUrl = await getServices().music.getPlayUrl(id)
          if (ctl.signal.aborted) return // 晚到的取链结果不得生效

          audio.src = playUrl.url
          void loadLyrics(song, playUrl.lyrics ?? '')
        }

        await waitForMetadata(audio, METADATA_TIMEOUT_MS)
        if (ctl.signal.aborted) return

        if (resumeAt > 0 && resumeAt < (audio.duration || Infinity) - 3) {
          audio.currentTime = resumeAt
        }

        // play() 在 CDN 挂死时可能永远 pending —— 12s 超时交给看门狗 recover
        await withTimeout(audio.play(), PLAY_TIMEOUT_MS, 'startPlayback')
        if (ctl.signal.aborted) return

        setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
        setIsPlaying(true)
      } catch (e) {
        if (ctl.signal.aborted) return
        const message = e instanceof Error ? e.message : String(e)
        console.warn(`[Player] startSource failed: ${message}`)
        // 交给统一恢复路径（会计数，超限才报错到 UI）
        recoverRef.current('start-failed')
      } finally {
        if (!ctl.signal.aborted) setIsLoading(false)
      }
    },
    [getAudio, loadLyrics],
  )

  /** 重取链续播恢复：最多 MAX_RECOVER_PER_SONG 次/首 */
  const recover = useCallback(
    (reason: string) => {
      const { currentSong: song } = stateRef.current
      if (song == null) return
      clearStallWatchdog()
      if (recoverCountRef.current >= MAX_RECOVER_PER_SONG) {
        setError(`播放失败（已重试 ${MAX_RECOVER_PER_SONG} 次）：${reason}`)
        setIsPlaying(false)
        setIsLoading(false)
        return
      }
      recoverCountRef.current += 1
      const resumeAt = getAudio().currentTime || 0
      console.warn(`[Player] recover #${recoverCountRef.current} (${reason}) @${resumeAt}s`)
      void startSource(song, resumeAt)
    },
    [clearStallWatchdog, getAudio, startSource],
  )
  const recoverRef = useRef(recover)
  recoverRef.current = recover

  const armStallWatchdog = useCallback(() => {
    clearStallWatchdog()
    stallTimerRef.current = setTimeout(() => {
      recoverRef.current('stalled 12s')
    }, STALL_WATCHDOG_MS)
  }, [clearStallWatchdog])

  // ---------- 公开动作 ----------

  const playSong = useCallback(
    (song: RawSong, newQueue?: RawSong[]) => {
      const audio = getAudio()
      const id = songKey(song)
      const q = newQueue ?? [song]
      const idx = q.findIndex((s) => songKey(s) === id)

      fadeCancelRef.current?.()
      clearStallWatchdog()
      recoverCountRef.current = 0
      setQueue(q)
      setCurrentIndex(idx >= 0 ? idx : 0)
      setCurrentSong(song)
      setCurrentTime(0)
      // 立即清空上一首歌词，并作废仍在途的歌词请求
      lyricsSerialRef.current += 1
      setLyrics('')

      // 断点恢复（长音频）
      const bookmark = readBookmark(id)

      // 150ms 淡出 → 切源（防爆音）
      const from = audio.volume
      fadeCancelRef.current = fadeVolume(audio, from, 0, FADE_MS, () => {
        audio.pause()
        audio.volume = stateRef.current.volume
        void startSource(song, bookmark)
      })
    },
    [clearStallWatchdog, getAudio, startSource],
  )

  const togglePlay = useCallback(() => {
    const audio = getAudio()
    const { currentSong: song } = stateRef.current
    if (song == null) return
    if (audio.paused) {
      void audio.play().catch((e) => recoverRef.current(`resume: ${e}`))
      setIsPlaying(true)
    } else {
      const from = audio.volume
      fadeCancelRef.current?.()
      fadeCancelRef.current = fadeVolume(audio, from, 0, FADE_MS, () => {
        audio.pause()
        audio.volume = stateRef.current.volume
        setIsPlaying(false)
      })
    }
  }, [getAudio])

  const stepTo = useCallback(
    (nextIndex: number) => {
      const { queue: q } = stateRef.current
      if (q.length === 0) return
      const song = q[nextIndex]
      if (song != null) playSong(song, q)
    },
    [playSong],
  )

  /** 跳到队列中指定下标（播放队列抽屉用） */
  const playAt = useCallback(
    (index: number) => {
      stepTo(index)
    },
    [stepTo],
  )

  const next = useCallback(() => {
    const { queue: q, currentIndex: idx, playMode: mode } = stateRef.current
    if (q.length === 0) return
    if (mode === PlayMode.Shuffle) {
      let r = Math.floor(Math.random() * q.length)
      if (q.length > 1 && r === idx) r = (r + 1) % q.length
      stepTo(r)
      return
    }
    stepTo((idx + 1) % q.length)
  }, [stepTo])

  const prev = useCallback(() => {
    const { queue: q, currentIndex: idx } = stateRef.current
    if (q.length === 0) return
    // 播放超 3s 按「上一首」先回开头（主流播放器习惯）
    if (getAudio().currentTime > 3) {
      getAudio().currentTime = 0
      return
    }
    stepTo((idx - 1 + q.length) % q.length)
  }, [getAudio, stepTo])

  const seek = useCallback(
    (seconds: number) => {
      const audio = getAudio()
      if (!Number.isFinite(audio.duration)) return
      const target = Math.max(0, Math.min(seconds, audio.duration))
      // seek 也走 150ms 斜坡防爆音
      const from = audio.volume
      fadeCancelRef.current?.()
      fadeCancelRef.current = fadeVolume(audio, from, 0, FADE_MS, () => {
        audio.currentTime = target
        audio.volume = stateRef.current.volume
        setCurrentTime(target)
      })
    },
    [getAudio],
  )

  const setVolume = useCallback(
    (v: number) => {
      const clamped = Math.max(0, Math.min(1, v))
      if (clamped > 0) {
        lastVolumeRef.current = clamped
        setIsMuted(false)
      }
      setVolumeState(clamped)
      getAudio().volume = clamped
    },
    [getAudio],
  )

  /** 音量增减一步（快捷键）：静音状态下先恢复再增减 */
  const stepVolume = useCallback(
    (delta: number) => {
      const base = isMuted ? 0 : stateRef.current.volume
      setVolume(base + delta)
    },
    [isMuted, setVolume],
  )

  const toggleMute = useCallback(() => {
    if (isMuted) {
      const restore = lastVolumeRef.current > 0 ? lastVolumeRef.current : 1
      lastVolumeRef.current = restore
      setIsMuted(false)
      setVolumeState(restore)
      getAudio().volume = restore
      return
    }
    lastVolumeRef.current = stateRef.current.volume > 0 ? stateRef.current.volume : 1
    setIsMuted(true)
    setVolumeState(0)
    getAudio().volume = 0
  }, [getAudio, isMuted])

  const cyclePlayMode = useCallback(() => {
    setPlayMode((m) =>
      m === PlayMode.List
        ? PlayMode.Single
        : m === PlayMode.Single
          ? PlayMode.Shuffle
          : PlayMode.List,
    )
  }, [])

  // ---------- audio 事件订阅 ----------

  useEffect(() => {
    const audio = getAudio()

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      // 断点记忆：长音频每 5s 落一次
      const { currentSong: song } = stateRef.current
      if (song == null) return
      if (
        Number.isFinite(audio.duration) &&
        audio.duration > BOOKMARK_MIN_DURATION &&
        audio.currentTime > 0
      ) {
        const now = Date.now()
        if (now - lastBookmarkSaveRef.current >= BOOKMARK_SAVE_INTERVAL_MS) {
          lastBookmarkSaveRef.current = now
          writeBookmark(songKey(song), audio.currentTime)
        }
      }
    }
    const onDurationChange = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    }
    const onPlaying = () => {
      setIsPlaying(true)
      clearStallWatchdog()
    }
    const onPause = () => setIsPlaying(false)
    const onWaiting = () => armStallWatchdog()
    const onStalled = () => armStallWatchdog()
    const onError = () => recoverRef.current('audio error event')
    const onEnded = () => {
      const { currentSong: song, playMode: mode } = stateRef.current
      if (song != null) clearBookmark(songKey(song))
      if (mode === PlayMode.Single) {
        audio.currentTime = 0
        void audio.play().catch(() => {})
        return
      }
      // list: 顺序推进（到尾停）；shuffle: 随机
      const { queue: q, currentIndex: idx } = stateRef.current
      if (q.length === 0) return
      if (mode === PlayMode.Shuffle) {
        stepTo(Math.floor(Math.random() * q.length))
        return
      }
      if (idx + 1 < q.length) {
        stepTo(idx + 1)
      } else {
        setIsPlaying(false)
      }
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('stalled', onStalled)
    audio.addEventListener('error', onError)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('stalled', onStalled)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('ended', onEnded)
    }
  }, [armStallWatchdog, clearStallWatchdog, getAudio, stepTo])

  // MediaSession 由 components/MediaSessionBridge.tsx 统一负责（元数据/播放态/进度/动作），
  // 这里不再重复设置，避免两个组件各写一套 mediaSession 而互相覆盖。

  const value = useMemo<PlayerState & PlayerActions>(
    () => ({
      currentSong,
      queue,
      currentIndex,
      isPlaying,
      isLoading,
      volume,
      isMuted,
      playMode,
      lyrics,
      error,
      playSong,
      playAt,
      togglePlay,
      next,
      prev,
      seek,
      setVolume,
      stepVolume,
      toggleMute,
      cyclePlayMode,
    }),
    [
      currentSong, queue, currentIndex, isPlaying, isLoading, volume, isMuted, playMode, lyrics, error,
      playSong, playAt, togglePlay, next, prev, seek, setVolume, stepVolume, toggleMute, cyclePlayMode,
    ],
  )

  // 进度值另开一层：只有读它的组件（播控栏 / 歌词抽屉 / 专注页）跟着 timeupdate 重渲染
  const timeValue = useMemo<PlayerTime>(
    () => ({ currentTime, duration }),
    [currentTime, duration],
  )

  return (
    <PlayerContext.Provider value={value}>
      <PlayerTimeContext.Provider value={timeValue}>{children}</PlayerTimeContext.Provider>
    </PlayerContext.Provider>
  )
}

export function usePlayer(): PlayerState & PlayerActions {
  const ctx = useContext(PlayerContext)
  if (ctx == null) throw new Error('usePlayer must be used within PlayerProvider')
  return ctx
}

/** 播放进度（currentTime / duration）—— 只有确实需要进度的组件才调这个钩子 */
export function usePlayerTime(): PlayerTime {
  const ctx = useContext(PlayerTimeContext)
  if (ctx == null) throw new Error('usePlayerTime must be used within PlayerProvider')
  return ctx
}
