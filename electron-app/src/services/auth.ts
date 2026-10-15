/**
 * 认证服务 —— 移植自 lib/services/auth_service.dart（AuthService + AuthNotifier 合并）。
 * HTTP 用 fetch，token 持久化用 localStorage（key 与 Dart SharedPreferences 一致：
 * 'auth_token'）。endpoint、payload、错误语义与 Dart 端一致：
 * - POST /auth/login、POST /auth/register、POST /auth/logout、GET /me
 * - Dio 对非 2xx 抛异常 → fetch 端等价地抛 ApiError（含 status）
 * - 登录/注册失败会重置状态并 rethrow；logout 的远端调用失败被吞掉
 * - 启动时用持久化 token 调 getMe 校验，失败则清除 token
 *
 * 语义取舍：
 * - Dart 的 AuthNotifier 通过 Riverpod ref 调用 libraryProvider，TS 端改为构造注入
 *   回调（onLibraryFromLogin / onAccountLibraryCleared），避免循环依赖。
 * - 10s 超时用 AbortController 实现（Dart Dio connect/receive timeout 各 10s）。
 */

import { createDefaultStorage, type KeyValueStorage } from './storage'
import type { RemoteLibrary } from './library'

export const AUTH_BASE_URL = 'http://60.205.218.90:8787/api'
/** localStorage key —— 与 Dart SharedPreferences key 一致 */
export const AUTH_TOKEN_KEY = 'auth_token'

const REQUEST_TIMEOUT_MS = 10_000

export class ApiError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string) {
    super(`API request failed with status ${status}: ${body}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export interface UserInfo {
  id: number
  username: string
  nickname: string
  avatarText: string
  avatarUrl: string
}

export interface AuthResult {
  user: UserInfo
  token: string
  library: RemoteLibrary | null
}

export interface AuthState {
  user: UserInfo | null
  token: string | null
  isLoading: boolean
}

export interface AuthServiceDeps {
  storage?: KeyValueStorage
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** 登录/注册响应里带 library 时回调（等价 Dart 的 setLibraryFromLogin） */
  onLibraryFromLogin?: (library: RemoteLibrary) => void
  /** 登出时回调（等价 Dart 的 clearAccountLibrary） */
  onAccountLibraryCleared?: () => void
}

export type AuthListener = (state: AuthState) => void

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function toInt(value: unknown): number {
  if (typeof value === 'number') return Math.round(value)
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

function nonEmptyString(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}

/** 与 Dart _avatarUrlValue 一致：http(s) 原样、// 补 https:、相对路径相对 baseUrl 解析 */
function resolveAvatarUrl(value: unknown, baseUrl: string): string | null {
  const text = nonEmptyString(value)
  if (text == null) return null
  if (/^https?:\/\//i.test(text)) return text
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return null // 其他 scheme（如 data:）拒绝
  if (text.startsWith('//')) return `https:${text}`
  try {
    return new URL(text, baseUrl).toString()
  } catch {
    return null
  }
}

export function userInfoFromJson(json: Record<string, unknown>, baseUrl: string): UserInfo {
  const username = String(json['username'] ?? '')
  return {
    id: toInt(json['id']),
    username,
    nickname: String(json['nickname'] ?? username),
    avatarText:
      nonEmptyString(json['avatarText']) ??
      (username !== '' ? username.charAt(0).toUpperCase() : 'A'),
    avatarUrl:
      resolveAvatarUrl(json['avatarUrl'], baseUrl) ??
      resolveAvatarUrl(json['avatar'], baseUrl) ??
      resolveAvatarUrl(json['avatar_url'], baseUrl) ??
      '',
  }
}

export class AuthService {
  private readonly storage: KeyValueStorage
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly onLibraryFromLogin?: (library: RemoteLibrary) => void
  private readonly onAccountLibraryCleared?: () => void

  private state: AuthState = { user: null, token: null, isLoading: false }
  private readonly listeners = new Set<AuthListener>()

  constructor(deps: AuthServiceDeps = {}) {
    this.storage = deps.storage ?? createDefaultStorage()
    this.baseUrl = deps.baseUrl ?? AUTH_BASE_URL
    this.fetchImpl = deps.fetchImpl ?? ((...args) => fetch(...args))
    this.onLibraryFromLogin = deps.onLibraryFromLogin
    this.onAccountLibraryCleared = deps.onAccountLibraryCleared
    // 等价 Dart AuthNotifier 构造时的 _loadStoredAuth（fire-and-forget）
    void this.restoreStoredAuth()
  }

  getSnapshot(): AuthState {
    return { ...this.state }
  }

  get isLoggedIn(): boolean {
    return this.state.user != null && this.state.token != null
  }

  get user(): UserInfo | null {
    return this.state.user
  }

  getToken(): string {
    return this.state.token ?? ''
  }

  subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 启动时恢复：token 存在则用 /me 校验；失败清除 token（与 Dart _loadStoredAuth 一致） */
  async restoreStoredAuth(): Promise<void> {
    const token = this.storage.getString(AUTH_TOKEN_KEY)
    if (token == null || token === '') return
    try {
      const user = await this.getMe(token)
      this.setState({ user, token, isLoading: false })
    } catch {
      this.storage.remove(AUTH_TOKEN_KEY)
    }
  }

  async login(username: string, password: string): Promise<void> {
    this.setState({ ...this.state, isLoading: true })
    try {
      const result = await this.loginRequest(username, password)
      this.storage.setString(AUTH_TOKEN_KEY, result.token)
      this.setState({ user: result.user, token: result.token, isLoading: false })
      if (result.library != null) {
        try {
          this.onLibraryFromLogin?.(result.library)
        } catch {
          /* library 回调失败不影响登录，与 Dart 一致 */
        }
      }
    } catch (error) {
      this.setState({ user: null, token: null, isLoading: false })
      throw error
    }
  }

  async register(username: string, password: string, nickname?: string): Promise<void> {
    this.setState({ ...this.state, isLoading: true })
    try {
      const result = await this.registerRequest(username, password, nickname)
      this.storage.setString(AUTH_TOKEN_KEY, result.token)
      this.setState({ user: result.user, token: result.token, isLoading: false })
      if (result.library != null) {
        try {
          this.onLibraryFromLogin?.(result.library)
        } catch {
          /* library 回调失败不影响注册，与 Dart 一致 */
        }
      }
    } catch (error) {
      this.setState({ user: null, token: null, isLoading: false })
      throw error
    }
  }

  async logout(): Promise<void> {
    const token = this.state.token
    if (token != null) {
      try {
        await this.request('POST', '/auth/logout', undefined, token)
      } catch {
        /* 远端登出失败吞掉，与 Dart 一致 */
      }
    }
    this.storage.remove(AUTH_TOKEN_KEY)
    try {
      this.onAccountLibraryCleared?.()
    } catch {
      /* 与 Dart 一致 */
    }
    this.setState({ user: null, token: null, isLoading: false })
  }

  // ---- 原始 API（等价 Dart AuthService 的四个方法，供需要 AuthResult 的调用方使用） ----

  async loginRequest(username: string, password: string): Promise<AuthResult> {
    const json = await this.request('POST', '/auth/login', { username, password })
    return this.authResultFromJson(json)
  }

  async registerRequest(
    username: string,
    password: string,
    nickname?: string,
  ): Promise<AuthResult> {
    const trimmed = nickname?.trim() ?? ''
    const json = await this.request('POST', '/auth/register', {
      username,
      password,
      ...(trimmed !== '' ? { nickname: trimmed } : {}),
    })
    return this.authResultFromJson(json)
  }

  async getMe(token: string): Promise<UserInfo> {
    const json = await this.request('GET', '/me', undefined, token)
    return userInfoFromJson(asRecord(json['user']) ?? {}, this.baseUrl)
  }

  /**
   * 上传头像 —— PUT /me/avatar { mimeType, imageBase64 }，与移动端
   * DeepVibeApiClient.uploadAvatar 一致；成功后用返回的 user 刷新本地状态
   * （头像 URL 由服务端签发，订阅方自动重渲染）。
   */
  async uploadAvatar(imageBase64: string, mimeType: string): Promise<UserInfo> {
    const token = this.state.token
    if (token == null || this.state.user == null) throw new ApiError(401, '未登录')
    const json = await this.request('PUT', '/me/avatar', { mimeType, imageBase64 }, token)
    const user = userInfoFromJson(asRecord(json['user']) ?? {}, this.baseUrl)
    this.setState({ user, token, isLoading: false })
    return user
  }

  // ---- 内部 ----

  private authResultFromJson(json: Record<string, unknown>): AuthResult {
    return {
      user: userInfoFromJson(asRecord(json['user']) ?? {}, this.baseUrl),
      token: String(json['token'] ?? ''),
      library: parseRemoteLibrary(json['library']),
    }
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    token?: string,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token != null ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body != null ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        throw new ApiError(response.status, text)
      }
      if (text === '') return {}
      const parsed: unknown = JSON.parse(text)
      return asRecord(parsed) ?? {}
    } finally {
      clearTimeout(timer)
    }
  }

  private setState(next: AuthState): void {
    this.state = next
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

/** 宽松解析登录响应里的 library，避免 auth → library 的运行时依赖 */
function parseRemoteLibrary(value: unknown): RemoteLibrary | null {
  const record = asRecord(value)
  if (record == null) return null
  return {
    likedSongs: listOfMaps(record['likedSongs']),
    userPlaylists: listOfMaps(record['userPlaylists']),
    themeMode: nonEmptyString(record['themeMode']) ?? 'dark',
  }
}

function listOfMaps(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => asRecord(item) != null)
}
