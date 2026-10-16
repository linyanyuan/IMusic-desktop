/**
 * 左侧导航栏（w-240）—— 搜索框 / 主导航 / 我的音乐 / 创建的歌单
 */

import { useState } from 'react'
import { Search, Home, Heart, Clock, Plus, ListMusic, X, Settings, Library, Trash2 } from 'lucide-react'
import { UserAvatar } from './UserAvatar'
import { Cover } from './Cover'
import { Modal } from './Modal'
import { DeskRoute, useRoute } from '../state/route'
import { useAuth, useLibrary } from '../state/hooks'

function NavItem({
  active,
  icon,
  label,
  onClick,
  testid,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
  testid?: string
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-[7px] text-left text-[13.5px] transition-colors ${
        active
          ? 'bg-accent/10 font-medium text-accent'
          : 'text-primary hover:bg-hover'
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}

function GroupTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-1 mt-5 flex items-center justify-between px-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
        {children}
      </span>
      {action}
    </div>
  )
}

export function Sidebar() {
  const route = useRoute()
  const library = useLibrary()
  const auth = useAuth()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const playlists = library.userPlaylists

  const submitCreate = async () => {
    const name = newName.trim()
    if (name === '' || busy) return
    setBusy(true)
    try {
      await library.createPlaylist(name)
      setNewName('')
      setCreating(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="flex w-[240px] shrink-0 flex-col bg-sidebar/85 backdrop-blur-xl">
      {/* 搜索框 */}
      <div className="px-3 pt-3">
        <div className="group relative">
          <Search
            size={14}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') route.openSearch(query)
            }}
            onFocus={() => route.openSearch(query)}
            placeholder="搜索歌曲、歌手、歌单"
            className="w-full rounded-lg border border-transparent bg-hover py-[7px] pl-8 pr-7 text-[13px] text-primary outline-none transition-colors placeholder:text-secondary focus:border-accent/30 focus:bg-card"
          />
          {query !== '' && (
            <button
              type="button"
              aria-label="清空"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary hover:text-primary"
            >
              <X size={13} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <div className="mt-3 space-y-0.5">
          <NavItem
            active={route.route === DeskRoute.Home}
            icon={<Home size={16} strokeWidth={1.75} />}
            label="首页"
            testid="nav-home"
            onClick={() => route.go(DeskRoute.Home)}
          />
          <NavItem
            active={route.route === DeskRoute.Search}
            icon={<Search size={16} strokeWidth={1.75} />}
            label="搜索"
            testid="nav-search"
            onClick={() => route.go(DeskRoute.Search)}
          />
          <NavItem
            active={route.route === DeskRoute.Library}
            icon={<Library size={16} strokeWidth={1.75} />}
            label="我的音乐"
            testid="nav-library"
            onClick={() => route.go(DeskRoute.Library)}
          />
        </div>

        <GroupTitle>我的音乐</GroupTitle>
        <div className="space-y-0.5">
          <NavItem
            active={route.route === DeskRoute.Favorites}
            icon={<Heart size={16} strokeWidth={1.75} />}
            label="我喜欢的音乐"
            onClick={() => route.go(DeskRoute.Favorites)}
          />
          <NavItem
            active={route.route === DeskRoute.History}
            icon={<Clock size={16} strokeWidth={1.75} />}
            label="历史播放"
            onClick={() => route.go(DeskRoute.History)}
          />
        </div>

        <GroupTitle
          action={
            <button
              type="button"
              aria-label="新建歌单"
              onClick={() => setCreating(true)}
              className="flex h-5 w-5 items-center justify-center rounded-md text-secondary transition-colors hover:bg-hover hover:text-primary"
            >
              <Plus size={14} strokeWidth={2} />
            </button>
          }
        >
          创建的歌单
        </GroupTitle>
        <div className="space-y-0.5">
          {playlists.length === 0 && (
            <p className="px-3 py-1 text-[12.5px] text-secondary">还没有歌单</p>
          )}
          {playlists.map((pl) => {
            const id = pl['id']?.toString() ?? ''
            const name = pl['name']?.toString() ?? '未命名歌单'
            const cover = pl['coverUrl']?.toString() ?? null
            const active =
              route.route === DeskRoute.PlaylistDetail && route.playlistId === id
            return (
              <div key={id} className="group/pl relative">
                <button
                  type="button"
                  onClick={() => route.go(DeskRoute.PlaylistDetail, { playlistId: id })}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-[6px] text-left text-[13.5px] transition-colors ${
                    active
                      ? 'bg-accent/10 font-medium text-accent'
                      : 'text-primary hover:bg-hover'
                  }`}
                >
                  {cover != null ? (
                    <Cover src={cover} size={28} radius="rounded-md" iconSize={12} seed={pl['name']?.toString()} />
                  ) : (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-hover text-secondary">
                      <ListMusic size={14} strokeWidth={1.75} />
                    </span>
                  )}
                  <span className="truncate">{name}</span>
                </button>
                <button
                  type="button"
                  aria-label={`删除歌单 ${name}`}
                  title="删除歌单"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(`删除歌单「${name}」？此操作不可恢复。`)) {
                      void library.deletePlaylist(id)
                    }
                  }}
                  className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-md p-1 text-secondary transition-colors hover:bg-hover hover:text-accent group-hover/pl:block"
                >
                  <Trash2 size={13} strokeWidth={2} />
                </button>
              </div>
            )
          })}
        </div>
      </nav>

      <div className="border-t border-subtle/70 p-2">
        <NavItem
          active={route.route === DeskRoute.Settings}
          // 与下方 20×20 的头像盒子同尺寸、同左缘起点，两行中轴才共线
          icon={
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              <Settings size={16} strokeWidth={1.75} />
            </span>
          }
          label="设置"
          testid="nav-settings"
          onClick={() => route.go(DeskRoute.Settings)}
        />
        {/* 我的主页（登录态入口，对应 Flutter DesktopUserLoginArea） */}
        <button
          type="button"
          data-testid="nav-profile"
          onClick={() => route.go(DeskRoute.Profile)}
          className={`mt-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-[7px] text-left text-[13.5px] transition-colors ${
            route.route === DeskRoute.Profile
              ? 'bg-accent/10 font-medium text-accent'
              : 'text-primary hover:bg-hover'
          }`}
        >
          {auth.user != null ? (
            <UserAvatar user={auth.user} size={20} />
          ) : (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-hover text-[9px] font-semibold text-secondary">
              ·
            </span>
          )}
          <span className="truncate">
            {auth.user != null ? auth.user.nickname || auth.user.username : '未登录'}
          </span>
        </button>
      </div>

      <Modal open={creating} title="新建歌单" onClose={() => setCreating(false)}>
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitCreate()
          }}
          placeholder="歌单名称"
          className="w-full rounded-lg border border-subtle px-3 py-2 text-[13.5px] outline-none focus:border-accent/40"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="rounded-lg px-3.5 py-1.5 text-[13px] text-secondary hover:bg-hover"
          >
            取消
          </button>
          <button
            type="button"
            disabled={newName.trim() === '' || busy}
            onClick={() => void submitCreate()}
            className="rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            创建
          </button>
        </div>
      </Modal>
    </aside>
  )
}
