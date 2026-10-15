/**
 * 设置页 —— 账号 / ChKSz 音源 / 缓存 / 歌词。
 * 所有改动立即写 localStorage（与 Dart 侧 key 一致）并即时生效。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, LogOut, RefreshCw, Trash2, Loader2, PlugZap, AlertCircle, Camera } from 'lucide-react'
import { UserAvatar } from '../components/UserAvatar'
import { TasteGenreChips } from '../components/TasteGenreChips'
import { useAuth, useLibrary, useSettings, useTastePreferences } from '../state/hooks'
import { MAX_TASTE_GENRES } from '../state/genres'
import { SettingsShortcuts } from '../components/SettingsShortcuts'
import { verifyChkszKey, type ChkszKeyCheck } from '../services/chksz'
import { formatBytes } from '../state/format'
import { argbToCss } from '../state/color'
import {
  checkForUpdate,
  installAndQuit,
  useAppVersion,
  useUpdateState,
} from '../state/update'

const LYRICS_FONT_MIN = 16
const LYRICS_FONT_MAX = 32

/** 歌词颜色预设（Dart ARGB int，与 AppSettings 存储一致） */
const LYRICS_COLOR_PRESETS: Array<{ value: number; label: string }> = [
  { value: 0xff1ed760, label: '网易绿' },
  { value: 0xfffa233b, label: 'IMusic 红' },
  { value: 0xff0a84ff, label: '系统蓝' },
  { value: 0xff1d1d1f, label: '墨黑' },
]

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-[#E5E5EA] bg-white/70 p-5 backdrop-blur-xl">
      <h2 className="text-[15px] font-semibold text-[#1D1D1F]">{title}</h2>
      {description != null && (
        <p className="mt-1 text-[12px] leading-5 text-[#86868B]">{description}</p>
      )}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  type = 'text',
  className = '',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel: string
  type?: 'text' | 'password' | 'number'
  className?: string
}) {
  return (
    <input
      type={type}
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg border border-[#E5E5EA] bg-white/80 px-3 py-2 text-[13px] text-[#1D1D1F] outline-none transition-colors placeholder:text-[#B0B0B5] focus:border-[#FA233B]/60 ${className}`}
    />
  )
}

function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  ariaLabel,
}: {
  children: ReactNode
  onClick: () => void
  variant?: 'default' | 'primary' | 'danger'
  disabled?: boolean
  ariaLabel?: string
}) {
  const tone =
    variant === 'primary'
      ? 'bg-[#FA233B] text-white hover:bg-[#E01E34]'
      : variant === 'danger'
        ? 'border border-[#FA233B]/40 text-[#FA233B] hover:bg-[#FA233B]/8'
        : 'border border-[#E5E5EA] text-[#1D1D1F] hover:bg-black/5'
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-medium transition-colors disabled:opacity-40 ${tone}`}
    >
      {children}
    </button>
  )
}

export function SettingsView() {
  const settings = useSettings()
  const auth = useAuth()
  const library = useLibrary()
  const snapshot = settings.getSnapshot()
  // 音乐口味偏好（localStorage）：实时读取，改动即时生效
  const taste = useTastePreferences()
  const tastePrefs = taste.get()

  // ---- 账号 ----
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  // ---- 头像上传（PUT /me/avatar，与移动端一致：居中裁方缩到 256px JPEG） ----
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarMessage, setAvatarMessage] = useState<string | null>(null)

  const onAvatarFile = useCallback(
    async (file: File | undefined) => {
      if (file == null) return
      if (!file.type.startsWith('image/')) {
        setAvatarMessage('请选择图片文件')
        return
      }
      setAvatarBusy(true)
      setAvatarMessage(null)
      try {
        const bitmap = await createImageBitmap(file)
        const size = 256
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (ctx == null) throw new Error('canvas 不可用')
        const side = Math.min(bitmap.width, bitmap.height)
        const sx = (bitmap.width - side) / 2
        const sy = (bitmap.height - side) / 2
        ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)
        bitmap.close()
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
        const base64 = dataUrl.split(',')[1] ?? ''
        if (base64 === '') throw new Error('图片编码失败')
        await auth.uploadAvatar(base64, 'image/jpeg')
        setAvatarMessage('头像已更新')
      } catch (e) {
        setAvatarMessage(e instanceof Error ? `头像上传失败：${e.message}` : '头像上传失败')
      } finally {
        setAvatarBusy(false)
      }
    },
    [auth],
  )

  // 桌面歌词窗口开关状态（设置页也能开，与播控栏/热键同步）
  const [desktopLyricsOpen, setDesktopLyricsOpen] = useState(false)
  useEffect(() => {
    const api = window.imusicAPI
    if (api?.onLyricsToggled == null) return
    void api.lyricsIsOpen?.().then(setDesktopLyricsOpen).catch(() => {})
    return api.onLyricsToggled(setDesktopLyricsOpen)
  }, [])

  const submitAuth = useCallback(async () => {
    if (username.trim() === '' || password === '') {
      setAuthError('请填写账号与密码')
      return
    }
    setAuthBusy(true)
    setAuthError(null)
    setAuthMessage(null)
    try {
      if (mode === 'login') {
        await auth.login(username.trim(), password)
      } else {
        await auth.register(username.trim(), password, nickname.trim() || undefined)
      }
      setPassword('')

      // 登录/注册响应里带 library 时，AuthService 已经通过 onLibraryFromLogin
      // 灌进本地库（runtime.ts 接线）；这里再拉一次作为兜底（响应没带库/字段改名都能兼容），
      // 并显示真实数量——不能让 UI 在没同步到时也显示「已同步」。
      let syncNote = ''
      try {
        await library.loadLibrary()
        syncNote = `，已同步 ${library.likedSongs.length} 首收藏 / ${library.playlists.length} 个歌单`
      } catch (e) {
        syncNote = `（音乐库同步失败：${e instanceof Error ? e.message : String(e)}）`
      }
      setAuthMessage(
        mode === 'login' ? `登录成功${syncNote}` : `注册成功，已自动登录${syncNote}`,
      )
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e))
    } finally {
      setAuthBusy(false)
    }
  }, [auth, library, mode, nickname, password, username])

  const logout = useCallback(async () => {
    setAuthBusy(true)
    setAuthError(null)
    setAuthMessage(null)
    try {
      await auth.logout()
      setAuthMessage('已退出登录')
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e))
    } finally {
      setAuthBusy(false)
    }
  }, [auth])

  // ---- ChKSz ----
  const [apiKey, setApiKey] = useState(snapshot.chkszApiKey)
  const [apiKeySaved, setApiKeySaved] = useState(false)
  const [keyCheck, setKeyCheck] = useState<ChkszKeyCheck | null>(null)
  const [keyChecking, setKeyChecking] = useState(false)

  // ---- 缓存 ----
  const [cacheDirInput, setCacheDirInput] = useState(snapshot.cacheDirectory)
  const [cacheInfo, setCacheInfo] = useState<{ fileCount: number; totalBytes: number; directory: string } | null>(null)
  const [cacheMessage, setCacheMessage] = useState<string | null>(null)
  const [cacheBusy, setCacheBusy] = useState(false)

  const refreshCacheInfo = useCallback(async () => {
    try {
      const info = await window.imusicAPI?.cacheStats()
      if (info != null) setCacheInfo(info)
    } catch (e) {
      setCacheMessage(`读取缓存信息失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  useEffect(() => {
    void refreshCacheInfo()
  }, [refreshCacheInfo])

  const applyCacheDirectory = useCallback(
    async (value: string) => {
      settings.setCacheDirectory(value)
      setCacheDirInput(value)
      try {
        const effective = await window.imusicAPI?.cacheSetDirectory(
          value.trim() === '' ? null : value.trim(),
        )
        setCacheMessage(effective != null ? `缓存目录已切换到 ${effective}` : '缓存目录已切换')
        await refreshCacheInfo()
      } catch (e) {
        setCacheMessage(`切换缓存目录失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [refreshCacheInfo, settings],
  )

  const clearCache = useCallback(async () => {
    setCacheBusy(true)
    try {
      const result = await window.imusicAPI?.cacheClear()
      setCacheMessage(
        result != null
          ? `已清理 ${result.removed} 个文件，释放 ${formatBytes(result.freedBytes)}`
          : '已清理缓存',
      )
      await refreshCacheInfo()
    } catch (e) {
      setCacheMessage(`清理缓存失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setCacheBusy(false)
    }
  }, [refreshCacheInfo])

  const user = auth.user

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-5 px-6 py-6">
      <h1 className="text-[22px] font-semibold tracking-tight text-[#1D1D1F]">设置</h1>

      {/* 账号 */}
      <Section title="账号" description="登录后可在多端同步歌单与收藏（后端与移动端共用）。">
        {user != null ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              {/* 头像：点击更换（hover 浮出相机遮罩） */}
              <button
                type="button"
                aria-label="更换头像"
                title="更换头像"
                disabled={avatarBusy}
                onClick={() => avatarInputRef.current?.click()}
                className="group relative h-11 w-11 shrink-0 rounded-full"
              >
                <UserAvatar user={user} size={44} />
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  {avatarBusy ? (
                    <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                  ) : (
                    <Camera size={14} strokeWidth={2} />
                  )}
                </span>
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                data-testid="avatar-file-input"
                className="hidden"
                onChange={(e) => {
                  void onAvatarFile(e.target.files?.[0])
                  e.target.value = '' // 允许重选同一文件
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium text-[#1D1D1F]">
                  {user.nickname || user.username}
                </div>
                <div className="truncate text-[12px] text-[#86868B]">@{user.username}</div>
              </div>
              <Button onClick={() => void logout()} disabled={authBusy} ariaLabel="退出登录">
                <LogOut size={14} strokeWidth={1.75} />
                退出登录
              </Button>
            </div>
            {avatarMessage != null && (
              <p className="text-[12px] text-[#86868B]">{avatarMessage}</p>
            )}
          </div>
        ) : (
          <>
            <div className="flex gap-1 rounded-lg bg-black/[0.04] p-1">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-label={m === 'login' ? '登录' : '注册'}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-md py-1.5 text-[12.5px] font-medium transition-colors ${
                    mode === m ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#86868B]'
                  }`}
                >
                  {m === 'login' ? '登录' : '注册'}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <TextInput
                value={username}
                onChange={setUsername}
                placeholder="账号"
                ariaLabel="账号"
                className="min-w-[180px] flex-1"
              />
              <TextInput
                value={password}
                onChange={setPassword}
                type="password"
                placeholder="密码"
                ariaLabel="密码"
                className="min-w-[180px] flex-1"
              />
              {mode === 'register' && (
                <TextInput
                  value={nickname}
                  onChange={setNickname}
                  placeholder="昵称（可选）"
                  ariaLabel="昵称"
                  className="min-w-[180px] flex-1"
                />
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button variant="primary" onClick={() => void submitAuth()} disabled={authBusy} ariaLabel="提交账号表单">
                {authBusy ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}
              </Button>
              {authMessage != null && (
                <span className="text-[12px] text-[#86868B]">{authMessage}</span>
              )}
            </div>
          </>
        )}
        {authError != null && <p className="text-[12px] text-[#FA233B]">{authError}</p>}
        {user != null && authMessage != null && (
          <p className="text-[12px] text-[#86868B]">{authMessage}</p>
        )}
      </Section>

      {/* ChKSz */}
      <Section
        title="ChKSz 音源"
        description="用于网易云音源（搜索 / 歌单 / 播放链接）。留空则关闭该音源，其余音源不受影响。保存后立即生效，无需重启。"
      >
        <div className="flex flex-wrap items-center gap-2">
          <TextInput
            value={apiKey}
            onChange={(v) => {
              setApiKey(v)
              setApiKeySaved(false)
              setKeyCheck(null)
            }}
            placeholder="chksz_..."
            ariaLabel="ChKSz API Key"
            className="min-w-[260px] flex-1 font-mono"
          />
          <Button
            variant="primary"
            ariaLabel="保存 API Key"
            onClick={() => {
              // 写进设置后 ChKSz 解析器（createChkszResolver）下一次取用就会用新 key，
              // 所以这里不需要重启，也不需要重建 MusicService
              settings.setChkszApiKey(apiKey)
              setApiKeySaved(true)
            }}
          >
            {apiKeySaved ? <Check size={14} strokeWidth={2} /> : null}
            保存
          </Button>
          <Button
            ariaLabel="测试 ChKSz 连接"
            disabled={keyChecking}
            onClick={() => {
              setKeyChecking(true)
              setKeyCheck(null)
              void verifyChkszKey(apiKey)
                .then(setKeyCheck)
                .finally(() => setKeyChecking(false))
            }}
          >
            {keyChecking ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <PlugZap size={14} strokeWidth={1.75} />
            )}
            测试连接
          </Button>
          {apiKey.trim() !== '' && (
            <Button
              ariaLabel="清除 ChKSz Key"
              onClick={() => {
                setApiKey('')
                settings.setChkszApiKey('')
                setApiKeySaved(true)
                setKeyCheck(null)
              }}
            >
              <Trash2 size={14} strokeWidth={1.75} />
              清除
            </Button>
          )}
        </div>
        <p className="text-[11.5px] text-[#86868B]">
          当前状态：
          {snapshot.chkszApiKey.trim() === '' ? '未配置（网易云音源已关闭）' : '已配置'}
          {apiKeySaved && <span className="ml-1 text-[#1D9E5F]">已保存 · 立即生效</span>}
        </p>
        {keyCheck != null && (
          <p
            data-chksz-check={keyCheck.ok ? 'ok' : 'fail'}
            className={`flex items-center gap-1.5 text-[12px] ${keyCheck.ok ? 'text-[#1D9E5F]' : 'text-[#FA233B]'}`}
          >
            {keyCheck.ok ? (
              <Check size={13} strokeWidth={2} />
            ) : (
              <AlertCircle size={13} strokeWidth={2} />
            )}
            {keyCheck.message}
          </p>
        )}
      </Section>

      {/* 缓存 */}
      <Section title="播放缓存" description="B站音源需要先落盘再播放，缓存目录与清理策略在此调整。">
        <div className="flex flex-wrap items-center gap-2">
          <TextInput
            value={cacheDirInput}
            onChange={setCacheDirInput}
            placeholder={cacheInfo?.directory ?? '默认目录'}
            ariaLabel="缓存目录"
            className="min-w-[260px] flex-1 font-mono text-[12px]"
          />
          <Button
            variant="primary"
            ariaLabel="保存缓存目录"
            onClick={() => void applyCacheDirectory(cacheDirInput)}
          >
            保存
          </Button>
          <Button ariaLabel="恢复默认缓存目录" onClick={() => void applyCacheDirectory('')}>
            恢复默认
          </Button>
        </div>
        <div className="flex items-center gap-2 text-[12.5px] text-[#1D1D1F]">
          <span className="text-[#86868B]">当前占用：</span>
          <span data-testid="cache-usage">
            {cacheInfo != null
              ? `${cacheInfo.fileCount} 个文件 · ${formatBytes(cacheInfo.totalBytes)}`
              : '统计中…'}
          </span>
          <button
            type="button"
            aria-label="刷新缓存统计"
            onClick={() => void refreshCacheInfo()}
            className="text-[#86868B] transition-colors hover:text-[#1D1D1F]"
          >
            <RefreshCw size={13} strokeWidth={1.75} />
          </button>
        </div>
        {cacheInfo != null && (
          <p className="break-all font-mono text-[11px] text-[#86868B]">{cacheInfo.directory}</p>
        )}
        <label className="flex items-center gap-2 text-[12.5px] text-[#1D1D1F]">
          <input
            type="checkbox"
            aria-label="自动清理过期缓存"
            checked={snapshot.cacheAutoCleanupEnabled}
            onChange={(e) => settings.setCacheAutoCleanupEnabled(e.target.checked)}
            className="h-4 w-4 accent-[#FA233B]"
          />
          自动清理过期缓存
        </label>
        <div className="flex items-center gap-2 text-[12.5px] text-[#1D1D1F]">
          <span className="text-[#86868B]">保留天数</span>
          <TextInput
            type="number"
            value={String(snapshot.cacheRetentionDays)}
            onChange={(v) => settings.setCacheRetentionDays(Number(v) || 1)}
            ariaLabel="缓存保留天数"
            className="w-[80px]"
          />
          <span className="text-[11.5px] text-[#86868B]">1–90 天</span>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="danger" onClick={() => void clearCache()} disabled={cacheBusy} ariaLabel="清理缓存">
            <Trash2 size={14} strokeWidth={1.75} />
            清理缓存
          </Button>
          {cacheMessage != null && (
            <span className="text-[12px] text-[#86868B]">{cacheMessage}</span>
          )}
        </div>
      </Section>

      {/* 快捷键 */}
      <Section
        title="快捷键"
        description="应用内快捷键（空格 / F）窗口聚焦时生效；全局热键由主进程注册，窗口未聚焦时也能控制播放。"
      >
        <SettingsShortcuts />
      </Section>

      {/* 桌面歌词窗口 */}
      <Section
        title="桌面歌词"
        description="独立透明置顶歌词条，可拖到屏幕任意位置；全局热键 Ctrl+Alt+D 也可开关。"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            ariaLabel={desktopLyricsOpen ? '关闭桌面歌词窗口' : '打开桌面歌词窗口'}
            onClick={() => {
              void window.imusicAPI?.lyricsToggle().then(setDesktopLyricsOpen).catch(() => {})
            }}
          >
            {desktopLyricsOpen ? '关闭桌面歌词窗口' : '打开桌面歌词窗口'}
          </Button>
          <span className="text-[12px] text-[#86868B]">
            当前：{desktopLyricsOpen ? '已打开' : '未打开'} · 播控栏右侧也可一键开关
          </span>
        </div>
      </Section>

      {/* 歌词 */}
      <Section title="歌词" description="歌词抽屉的字号与高亮颜色，改动即时生效。">
        <div className="flex items-center gap-4">
          <span className="w-[60px] shrink-0 text-[12.5px] text-[#86868B]">字号</span>
          <input
            type="range"
            min={LYRICS_FONT_MIN}
            max={LYRICS_FONT_MAX}
            value={snapshot.lyricsFontSize}
            aria-label="歌词字号"
            onChange={(e) => settings.setLyricsFontSize(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer accent-[#FA233B]"
          />
          <span className="w-[46px] text-right text-[12.5px] tabular-nums text-[#1D1D1F]">
            {snapshot.lyricsFontSize}px
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-[60px] shrink-0 text-[12.5px] text-[#86868B]">高亮色</span>
          <div className="flex items-center gap-2">
            {LYRICS_COLOR_PRESETS.map((preset) => {
              const selected = snapshot.lyricsColorValue === preset.value
              return (
                <button
                  key={preset.value}
                  type="button"
                  aria-label={`歌词高亮色 ${preset.label}`}
                  title={preset.label}
                  onClick={() => settings.setLyricsColorValue(preset.value)}
                  style={{ backgroundColor: argbToCss(preset.value) }}
                  className={`h-6 w-6 rounded-full transition-transform ${
                    selected ? 'ring-2 ring-offset-2 ring-[#1D1D1F]/30' : 'hover:scale-110'
                  }`}
                />
              )
            })}
          </div>
        </div>
      </Section>

      {/* 音乐口味 */}
      <Section
        title="音乐口味"
        description="首页「推荐歌曲」会按这里选择的分类做个性化推荐（网易云分类热门）；清除后回到默认推荐。"
      >
        <TasteGenreChips
          selected={tastePrefs.genres}
          onChange={(genres) => taste.set({ genres })}
        />
        <div className="flex flex-wrap items-center gap-3">
          <span data-testid="taste-summary" className="text-[12px] text-[#86868B]">
            {tastePrefs.genres.length > 0
              ? `已选 ${tastePrefs.genres.length}/${MAX_TASTE_GENRES} 个分类 · 改动即时生效`
              : '未选择分类（使用默认推荐）'}
          </span>
          {tastePrefs.genres.length > 0 && (
            <Button ariaLabel="清除音乐口味" onClick={() => taste.clear()}>
              <Trash2 size={14} strokeWidth={1.75} />
              清除
            </Button>
          )}
        </div>
      </Section>

      {/* 关于 —— 对应 Flutter desktop_settings_screen.dart 的「关于」段 */}
      <AboutSection />
    </div>
  )
}

function AboutSection() {
  const version = useAppVersion()
  const state = useUpdateState()

  // 按钮文案跟随更新状态机，与 Dart 端 switch 出来的一致
  const { label, disabled } = (() => {
    switch (state.kind) {
      case 'checking':
        return { label: '检查中…', disabled: true }
      case 'available':
        return { label: `有新版本 v${state.manifest.version}`, disabled: false }
      case 'downloading': {
        const percent =
          state.total != null && state.total > 0
            ? `${Math.round((state.received / state.total) * 100)}%`
            : '…'
        return { label: `下载中 ${percent}`, disabled: true }
      }
      case 'downloaded':
        return { label: '去安装', disabled: false }
      case 'upToDate':
        return { label: '已是最新', disabled: false }
      case 'error':
        return { label: '检查失败，重试', disabled: false }
      default:
        return { label: '检查更新', disabled: false }
    }
  })()

  return (
    <Section title="关于" description="检查新版本；下载会校验 sha256，安装时软件会退出并自动重启。">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] text-[#86868B]">当前版本</span>
          <span
            data-app-version={version ?? ''}
            className="text-[13px] tabular-nums text-[#1D1D1F]"
          >
            v{version ?? '…'}
          </span>
        </div>
        <button
          type="button"
          data-update-action="check"
          disabled={disabled}
          onClick={() => {
            if (state.kind === 'downloaded') {
              void installAndQuit()
              return
            }
            void checkForUpdate(true)
          }}
          className={`flex items-center gap-1.5 rounded-lg border border-[#E5E5EA] bg-white px-3 py-1.5 text-[12.5px] transition-colors ${
            disabled ? 'cursor-default text-[#86868B]' : 'hover:bg-black/[0.03] text-[#1D1D1F]'
          }`}
        >
          <RefreshCw
            size={13}
            strokeWidth={1.75}
            className={state.kind === 'checking' ? 'animate-spin' : ''}
          />
          {label}
        </button>
      </div>
    </Section>
  )
}
