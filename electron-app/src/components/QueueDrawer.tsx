/**
 * 播放队列抽屉 —— 当前曲目高亮 + 打开自动定位 + 点击任意行跳播。
 */

import { useEffect, useRef } from 'react'
import { ListMusic, X } from 'lucide-react'
import { Cover } from './Cover'
import { PlayingIndicator } from './PlayingIndicator'
import { usePlayer } from '../contexts/PlayerContext'
import { durationSeconds, formatTime, songCover, toSong } from '../state/songUtils'

export function QueueDrawer({ onClose }: { onClose: () => void }) {
  const player = usePlayer()
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLButtonElement>(null)

  // 打开时（以及切歌后）把当前曲目滚到可视区
  useEffect(() => {
    const container = scrollRef.current
    const el = currentRef.current
    if (container == null || el == null) return
    const top = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [player.currentIndex])

  return (
    <>
      <div className="flex items-center justify-between border-b border-[#E5E5EA]/70 px-5 py-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-[#1D1D1F]">播放队列</h3>
          <p className="truncate text-[11.5px] text-[#86868B]">
            {player.queue.length > 0
              ? `共 ${player.queue.length} 首${player.currentIndex >= 0 ? ` · 正在播放第 ${player.currentIndex + 1} 首` : ''}`
              : '队列为空'}
          </p>
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

      <div ref={scrollRef} className="h-[calc(100%-53px)] overflow-y-auto px-3 py-3">
        {player.queue.length === 0 ? (
          <p className="px-2 text-[13px] text-[#86868B]">播放队列为空</p>
        ) : (
          <ul className="space-y-0.5">
            {player.queue.map((raw, i) => {
              const item = toSong(raw)
              const itemSeconds = durationSeconds(item)
              const isCurrent = i === player.currentIndex
              return (
                <li key={`${item.id}-${i}`}>
                  <button
                    type="button"
                    ref={isCurrent ? currentRef : null}
                    data-queue-index={i}
                    data-active={isCurrent ? 'true' : 'false'}
                    onClick={() => player.playAt(i)}
                    className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-black/5 ${
                      isCurrent ? 'bg-[#FA233B]/8 text-[#FA233B]' : 'text-[#1D1D1F]'
                    }`}
                  >
                    <span className="flex w-4 shrink-0 items-center justify-center text-[12px] tabular-nums text-[#86868B]">
                      {isCurrent && player.isPlaying ? <PlayingIndicator size={12} /> : i + 1}
                    </span>
                    <Cover src={songCover(item)} size={32} radius="rounded-md" iconSize={12} seed={item['title']?.toString()} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[13px] ${isCurrent ? 'font-medium' : ''}`}
                      >
                        {item.title}
                      </span>
                      <span className="block truncate text-[11.5px] text-[#86868B]">
                        {item.artist}
                      </span>
                    </span>
                    {itemSeconds > 0 && (
                      <span className="shrink-0 text-[11.5px] tabular-nums text-[#86868B]">
                        {formatTime(itemSeconds)}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {player.queue.length === 0 && (
        <div className="absolute bottom-6 left-0 right-0 flex flex-col items-center gap-2 text-[#86868B]">
          <ListMusic size={26} strokeWidth={1.5} />
          <span className="text-[12.5px]">从首页或搜索里点一首歌吧</span>
        </div>
      )}
    </>
  )
}
