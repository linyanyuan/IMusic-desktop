/**
 * 全局提示条 —— Flutter 端 SnackBar 的等价物：浮在播控栏（高 76px）上方，
 * 约 2 秒后由 src/state/notice.ts 的计时器自动清除。
 *
 * 位置用 flex 居中（inset-x-0 + justify-center），**不用 -translate-x-1/2**：
 * 项目硬约束，避免给内部 position:fixed 后代造出包含块。
 */

import { useNotice } from '../state/notice'

export function NoticeToast() {
  const notice = useNotice()
  if (notice == null) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[92px] z-[70] flex justify-center px-4"
      data-testid="notice-toast"
      aria-live="polite"
    >
      {/* key 绑 id：提示被替换时重挂载节点，便于后续加进出场动画（本次不做） */}
      <div
        key={notice.id}
        className="rounded-full border border-subtle bg-card/95 px-4 py-2 text-[13px] text-primary shadow-[0_8px_24px_rgba(0,0,0,0.12)] backdrop-blur-xl"
      >
        {notice.message}
      </div>
    </div>
  )
}
