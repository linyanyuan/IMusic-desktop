/**
 * 前进/后退导航控件 —— 摆在主内容区顶部的浮条（App.tsx MainContent）。
 *
 * 设计：Spotify 风格的一对 28px 圆形 chevron 按钮，左对齐；
 * 无历史方向置灰禁用，有历史时深灰 + hover 浅灰底。
 * 三个入口共用同一历史栈：
 * - 按钮点击
 * - 键盘 Alt+← / Alt+→（浏览器惯例；与全局热键 Ctrl+Alt+方向键不冲突）
 * - 鼠标侧键（主进程 app-command 转发的 browser-backward/forward）
 */

import { useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRoute } from '../state/route'

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label}（${label === '后退' ? 'Alt+←' : 'Alt+→'}）`}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-full transition-all ${
        disabled
          ? 'cursor-default text-[#C7C7CC]'
          : 'text-[#1D1D1F] hover:bg-black/[0.06] active:scale-90'
      }`}
    >
      {children}
    </button>
  )
}

export function NavHistoryControls() {
  const route = useRoute()

  // 键盘：Alt+← / Alt+→（输入框聚焦时不抢键）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return
      const target = e.target as HTMLElement | null
      if (
        target != null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        route.back()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        route.forward()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route])

  // 鼠标侧键（XButton1/2 → 主进程 app-command → IPC）
  useEffect(() => {
    const api = window.imusicAPI
    if (api?.onNavHistory == null) return
    return api.onNavHistory((direction) => {
      if (direction === 'back') route.back()
      else route.forward()
    })
  }, [route])

  return (
    <div data-testid="nav-history" className="flex items-center gap-1">
      <NavButton label="后退" disabled={!route.canGoBack} onClick={route.back}>
        <ChevronLeft size={17} strokeWidth={2} />
      </NavButton>
      <NavButton label="前进" disabled={!route.canGoForward} onClick={route.forward}>
        <ChevronRight size={17} strokeWidth={2} />
      </NavButton>
    </div>
  )
}
