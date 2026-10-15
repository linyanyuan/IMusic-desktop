/**
 * 正在播放指示器 —— Apple Music 列表里的跳动音柱（3 根，相位错开）。
 * 用于歌曲列表「正在播放」行，替代静态序号/图标。
 */

export function PlayingIndicator({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`flex items-end justify-center gap-[2.5px] ${className}`}
      style={{ height: size }}
      aria-hidden="true"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[2.5px] rounded-full bg-[#FA233B] animate-[eq_900ms_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  )
}
