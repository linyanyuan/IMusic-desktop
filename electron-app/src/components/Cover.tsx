/**
 * 封面图 —— 破图/无封面时退化为「按标题哈希取色」的柔和渐变 + 音符图标，
 * 而不是一片死灰（Apple Music 风格：每张占位封面颜色不同、可辨认）。
 *
 * 性能：列表里一次会挂几十张远端封面（B站/网易云图床），所以用原生懒加载
 * （`loading="lazy"` 让屏幕外的图不发请求）+ `decoding="async"` 把解码移出主线程；
 * 加载完成做一次淡入 + 轻微放大（只动 transform/opacity，交给合成器，长列表里也便宜）。
 */

import { useState } from 'react'
import { Music2 } from 'lucide-react'

/** 稳定的字符串哈希 → 0-359 色相（同一标题永远同色） */
function hueOf(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return ((hash % 360) + 360) % 360
}

/**
 * 封面的内联尺寸规则 —— 单独导出以便回归测试。
 *
 * size=0 是调用方约定：**不**下发内联尺寸，由 className 决定
 * （首页卡片用 `size={0}` + `!h-auto aspect-square w-full` 填满网格单元）。
 * 内联样式优先级高于 class —— 无条件写 `width: 0` 会把封面压成 0 宽，
 * 表现为「首页热门歌单/推荐歌曲/最近播放全都没有封面」（2026-10 真实回归）。
 */
export function coverStyle(
  size: number,
  placeholderStyle?: Record<string, string>,
): Record<string, string | number> {
  return {
    ...(size > 0 ? { width: size, height: size } : {}),
    ...(placeholderStyle ?? {}),
  }
}

export function Cover({
  src,
  size,
  radius = 'rounded-xl',
  className = '',
  iconSize,
  testid,
  seed,
}: {
  src?: string | null
  size: number
  radius?: string
  className?: string
  iconSize?: number
  testid?: string
  /** 占位渐变的取色种子（通常是歌曲标题）；与 src 都没有时用中性灰 */
  seed?: string
}) {
  const [broken, setBroken] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // src 变化时重置状态（调用方会复用同一个 Cover 实例切歌，例如 PlayerBar/FocusView）：
  // 否则上一首的「已加载」或「破图」会被带到下一首，新封面永远不显示。
  // 用渲染期重置（React 官方推荐模式），避开 effect 与缓存图片 load 事件的竞态。
  const [prevSrc, setPrevSrc] = useState(src)
  if (prevSrc !== src) {
    setPrevSrc(src)
    setBroken(false)
    setLoaded(false)
  }
  const showImage = src != null && src !== '' && !broken

  const hue = hueOf(seed ?? src ?? '')
  const hasHue = (seed ?? src ?? '') !== ''
  const placeholderStyle = hasHue
    ? {
        background: `linear-gradient(135deg, hsl(${hue} 72% 90%), hsl(${(hue + 32) % 360} 58% 80%))`,
      }
    : undefined
  const iconColor = hasHue ? `hsl(${hue} 42% 52%)` : undefined

  return (
    <div
      data-testid={testid}
      data-cover-loaded={showImage ? String(loaded) : 'fallback'}
      className={`relative shrink-0 overflow-hidden ${hasHue ? '' : 'bg-gradient-to-br from-fill to-subtle'} ${radius} ${className}`}
      // size=0 是调用方约定：不下发内联尺寸，由 className 决定（w-full aspect-square 填满网格单元）。
      // 内联样式优先级高于 class —— 无条件写 width:0 会把封面压成 0 宽（2026-10 回归，首页三个分区封面全消失）。
      style={coverStyle(size, placeholderStyle)}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          // 命中缓存时 load 事件可能早于 React 挂载 —— 用 complete 兜底，避免永远淡入不了
          ref={(el) => {
            if (el != null && el.complete && el.naturalWidth > 0 && !loaded) setLoaded(true)
          }}
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
          className={`h-full w-full object-cover transition-[opacity,transform] duration-300 ease-out ${
            loaded ? 'scale-100 opacity-100' : 'scale-[0.97] opacity-0'
          }`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center" style={{ color: iconColor ?? '#C7C7CC' }}>
          <Music2
            // size=0 时不能算 Math.round(0 * 0.4)=0（不可见的 0×0 图标）；
            // 未知容器尺寸就交给 className 按比例撑满。
            size={iconSize ?? (size > 0 ? Math.round(size * 0.4) : undefined)}
            className={iconSize == null && size <= 0 ? 'h-1/3 w-1/3' : undefined}
            strokeWidth={1.5}
          />
        </div>
      )}
    </div>
  )
}
