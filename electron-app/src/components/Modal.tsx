/** 极简居中弹窗 —— 毛玻璃遮罩 + 柔和阴影 */

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({
  open,
  title,
  onClose,
  children,
  width = 420,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  // onClose 通常是内联箭头函数（每次渲染都是新引用），直接放进依赖会让 Escape
  // 监听每渲染都卸装重装；用 ref 取最新引用，只在 open 变化时重挂。
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="rounded-2xl border border-subtle bg-card/95 p-6 shadow-[0_24px_64px_rgba(0,0,0,0.18)] backdrop-blur-2xl"
        style={{ width }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold tracking-tight text-primary">{title}</h2>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-hover"
          >
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
