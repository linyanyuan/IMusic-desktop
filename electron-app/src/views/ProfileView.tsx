/**
 * 我的主页 —— 对应 Flutter DesktopProfileScreen：
 * 用户头部（头像/昵称/@用户名 + 喜欢/创建/收藏 三个指标）+ 音乐库入口
 * + 创建的歌单 / 收藏的歌单。未登录时给出登录入口（账号表单在设置页）。
 */

import { Heart, ListMusic, Clock, ChevronRight, LogOut, UserCircle2 } from 'lucide-react'
import { UserAvatar } from '../components/UserAvatar'
import { Cover } from '../components/Cover'
import { useAuth, useLibrary } from '../state/hooks'
import { DeskRoute, useRoute } from '../state/route'

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl bg-white/60 px-4 py-2.5 text-center backdrop-blur">
      <div className="text-[19px] font-semibold tabular-nums text-[#1D1D1F]">{value}</div>
      <div className="mt-0.5 text-[11.5px] text-[#86868B]">{label}</div>
    </div>
  )
}

function PlaylistCard({
  name,
  cover,
  count,
  onClick,
  collected,
}: {
  name: string
  cover: string | null
  count: number
  onClick: () => void
  collected: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-4 rounded-2xl border border-[#E5E5EA] bg-white/70 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(0,0,0,0.08)]"
    >
      {cover != null ? (
        <Cover src={cover} size={56} radius="rounded-xl" iconSize={18} seed={name} />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#FA233B]/10 text-[#FA233B]">
          {collected ? <Heart size={20} strokeWidth={1.75} /> : <ListMusic size={20} strokeWidth={1.75} />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-[#1D1D1F]">{name}</div>
        <div className="mt-1 text-[12px] text-[#86868B]">{count} 首</div>
      </div>
      <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-[#C7C7CC] group-hover:text-[#86868B]" />
    </button>
  )
}

export function ProfileView() {
  const auth = useAuth()
  const library = useLibrary()
  const route = useRoute()

  const user = auth.user
  const playlists = library.userPlaylists
  const created = playlists.filter((pl) => pl['isCollected'] !== true)
  const collected = playlists.filter((pl) => pl['isCollected'] === true)

  const playlistName = (pl: Record<string, unknown>) =>
    pl['name']?.toString() ?? pl['title']?.toString() ?? '未命名歌单'
  const playlistCover = (pl: Record<string, unknown>) => pl['coverUrl']?.toString() ?? null
  const playlistCount = (pl: Record<string, unknown>) =>
    Array.isArray(pl['songs']) ? (pl['songs'] as unknown[]).length : 0

  if (user == null) {
    return (
      <div data-testid="profile-view" className="flex h-full flex-col items-center justify-center gap-3">
        <UserCircle2 size={44} strokeWidth={1.25} className="text-[#C7C7CC]" />
        <p className="text-[15px] font-medium text-[#1D1D1F]">还没有登录</p>
        <p className="text-[13px] text-[#86868B]">登录后可在多端同步歌单与收藏</p>
        <button
          type="button"
          data-testid="profile-login-entry"
          onClick={() => route.go(DeskRoute.Settings)}
          className="mt-2 rounded-full bg-[#FA233B] px-5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#E01E34]"
        >
          去登录
        </button>
      </div>
    )
  }

  return (
    <div data-testid="profile-view" className="space-y-6">
      {/* 用户头部 */}
      <div className="relative overflow-hidden rounded-3xl border border-[#E5E5EA] bg-gradient-to-br from-[#FFF5F6] to-[#F5F5F7] p-8">
        <div className="flex items-center gap-6">
          <UserAvatar user={user} size={104} className="shadow-[0_12px_32px_rgba(250,35,59,0.3)]" />
          <div className="min-w-0 flex-1">
            <h1 data-testid="profile-nickname" className="truncate text-[30px] font-bold tracking-tight text-[#1D1D1F]">
              {user.nickname || user.username}
            </h1>
            <p data-testid="profile-username" className="mt-1 truncate text-[13.5px] text-[#86868B]">
              @{user.username}
            </p>
            <div className="mt-4 flex gap-3">
              <Metric value={library.likedSongs.length} label="喜欢" />
              <Metric value={created.length} label="创建歌单" />
              <Metric value={collected.length} label="收藏歌单" />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void auth.logout()}
            className="flex shrink-0 items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-[12.5px] text-[#86868B] backdrop-blur transition-colors hover:text-[#FA233B]"
          >
            <LogOut size={14} strokeWidth={1.75} />
            退出登录
          </button>
        </div>
      </div>

      {/* 音乐库 */}
      <section>
        <h2 className="mb-3 text-[16px] font-semibold tracking-tight text-[#1D1D1F]">音乐库</h2>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            data-testid="profile-liked-card"
            onClick={() => route.go(DeskRoute.Favorites)}
            className="flex items-center gap-4 rounded-2xl border border-[#E5E5EA] bg-white/70 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(0,0,0,0.08)]"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#FA233B] to-[#FF7A59] text-white">
              <Heart size={22} strokeWidth={1.75} fill="currentColor" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-[#1D1D1F]">我喜欢的音乐</div>
              <div className="mt-1 text-[12px] text-[#86868B]">{library.likedSongs.length} 首</div>
            </div>
            <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-[#C7C7CC]" />
          </button>
          <button
            type="button"
            data-testid="profile-history-card"
            onClick={() => route.go(DeskRoute.History)}
            className="flex items-center gap-4 rounded-2xl border border-[#E5E5EA] bg-white/70 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(0,0,0,0.08)]"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#F5F5F7] text-[#1D1D1F]">
              <Clock size={22} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-[#1D1D1F]">历史播放</div>
              <div className="mt-1 text-[12px] text-[#86868B]">{library.history.length} 条</div>
            </div>
            <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-[#C7C7CC]" />
          </button>
        </div>
      </section>

      {/* 创建的歌单 */}
      <section data-testid="profile-created">
        <h2 className="mb-3 text-[16px] font-semibold tracking-tight text-[#1D1D1F]">创建的歌单</h2>
        {created.length === 0 ? (
          <p className="text-[13px] text-[#86868B]">还没有创建的歌单</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {created.map((pl) => (
              <PlaylistCard
                key={pl['id']?.toString() ?? ''}
                name={playlistName(pl)}
                cover={playlistCover(pl)}
                count={playlistCount(pl)}
                collected={false}
                onClick={() =>
                  route.go(DeskRoute.PlaylistDetail, { playlistId: pl['id']?.toString() ?? '' })
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* 收藏的歌单 */}
      <section data-testid="profile-collected">
        <h2 className="mb-3 text-[16px] font-semibold tracking-tight text-[#1D1D1F]">收藏的歌单</h2>
        {collected.length === 0 ? (
          <p className="text-[13px] text-[#86868B]">还没有收藏的歌单</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {collected.map((pl) => (
              <PlaylistCard
                key={pl['id']?.toString() ?? ''}
                name={playlistName(pl)}
                cover={playlistCover(pl)}
                count={playlistCount(pl)}
                collected
                onClick={() =>
                  route.go(DeskRoute.PlaylistDetail, { playlistId: pl['id']?.toString() ?? '' })
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
