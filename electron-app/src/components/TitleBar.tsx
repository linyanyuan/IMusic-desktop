/** 无边框窗口自绘标题栏（Windows 风格控件）
 *
 * 前进/后退按钮放在标题栏里、顶在侧栏右沿（侧栏区 240px 内右对齐）；
 * 按钮自身 no-drag（标题栏其余区域仍可拖动窗口）。
 */

import { useEffect, useState } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'
import { NavHistoryControls } from './NavHistoryControls'

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.imusicAPI?.winIsMaximized().then((v) => setMaximized(v ?? false))
  }, [])

  const api = window.imusicAPI

  return (
    <div className="drag-region relative flex h-[38px] shrink-0 items-center justify-between border-b border-subtle/70 bg-sidebar/70 backdrop-blur-xl">
      <div className="pl-4 text-[13px] font-medium tracking-tight text-secondary">
        IMusic
      </div>
      {/* 前进/后退：顶在侧栏右沿（侧栏区 240px 内右对齐，右内边距 12px） */}
      <div className="no-drag absolute left-0 top-0 flex h-full w-[240px] items-center justify-end pr-3">
        <NavHistoryControls />
      </div>
      <div className="no-drag flex h-full items-center">
        <button
          type="button"
          aria-label="最小化"
          onClick={() => void api?.winMinimize()}
          className="flex h-full w-[46px] items-center justify-center text-secondary transition-colors hover:bg-hover"
        >
          <Minus size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label={maximized ? '还原' : '最大化'}
          onClick={() => {
            void api?.winMaximize()
            setMaximized((m) => !m)
          }}
          className="flex h-full w-[46px] items-center justify-center text-secondary transition-colors hover:bg-hover"
        >
          {maximized ? (
            <Copy size={12} strokeWidth={1.75} />
          ) : (
            <Square size={12} strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          aria-label="关闭"
          onClick={() => void api?.winClose()}
          className="flex h-full w-[46px] items-center justify-center text-secondary transition-colors hover:bg-accent hover:text-white"
        >
          <X size={15} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
