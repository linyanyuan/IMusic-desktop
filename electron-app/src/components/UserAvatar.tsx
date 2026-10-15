/**
 * 用户头像 —— 有 avatarUrl 显示图片（破图回退字母），否则字母头像。
 * 云端相对路径（/uploads/avatars/...）已在 userInfoFromJson 里解析成绝对 URL。
 */

import { useState } from 'react'
import type { UserInfo } from '../services/auth'

export function UserAvatar({
  user,
  size,
  className = '',
}: {
  user: UserInfo | null
  size: number
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  const url = user?.avatarUrl ?? ''
  // url 变化（换账号 / 换头像）时重置破图状态，否则新头像沿用上一个的
  // 「已破」标记，永远显示字母。渲染期重置，避开 effect 与缓存 load 的竞态。
  const [prevUrl, setPrevUrl] = useState(url)
  if (prevUrl !== url) {
    setPrevUrl(url)
    setBroken(false)
  }
  const showImage = url !== '' && !broken
  const letter =
    user != null
      ? ((user.avatarText || user.nickname.slice(0, 1) || '·').slice(0, 1) || '·')
      : '·'

  return (
    <div
      data-user-avatar
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full text-white ${
        showImage ? 'bg-black/10' : 'bg-gradient-to-br from-[#FA233B] to-[#86868B]'
      } ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), fontWeight: 600 }}
    >
      {showImage ? (
        <img
          src={url}
          alt={user?.nickname ?? '用户头像'}
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="uppercase">{letter}</span>
      )}
    </div>
  )
}
