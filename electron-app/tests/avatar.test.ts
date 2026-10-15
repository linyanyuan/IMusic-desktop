// 用户头像 —— 回归锚点。
//
// 后端 /me 会返回 avatarUrl（相对路径 /uploads/avatars/...），移动端已能上传
// （PUT /me/avatar { mimeType, imageBase64 }）。electron-app 早期只渲染字母头像，
// 等于头像没打通；上传功能也缺失。

import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthService, userInfoFromJson, ApiError } from '../src/services/auth'
import type { KeyValueStorage } from '../src/services/storage'

const BASE = 'http://60.205.218.90:8787/api'

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>()
  return {
    getString: (k) => map.get(k) ?? null,
    setString: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
    getStringList: () => [],
    setStringList: () => {},
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('avatarUrl 相对路径按 baseUrl 解析成绝对 URL', () => {
  const user = userInfoFromJson(
    { username: 'a', avatarUrl: '/uploads/avatars/user-1-x.jpg' },
    BASE,
  )
  assert.equal(user.avatarUrl, 'http://60.205.218.90:8787/uploads/avatars/user-1-x.jpg')
})

test('avatar / avatar_url 字段兼容；http(s) 原样保留；// 补 https', () => {
  assert.equal(
    userInfoFromJson({ username: 'a', avatar: '/u/1.jpg' }, BASE).avatarUrl,
    'http://60.205.218.90:8787/u/1.jpg',
  )
  assert.equal(
    userInfoFromJson({ username: 'a', avatar_url: '//cdn.x.com/a.jpg' }, BASE).avatarUrl,
    'https://cdn.x.com/a.jpg',
  )
  assert.equal(
    userInfoFromJson({ username: 'a', avatarUrl: 'https://cdn.x.com/b.jpg' }, BASE).avatarUrl,
    'https://cdn.x.com/b.jpg',
  )
  assert.equal(userInfoFromJson({ username: 'a' }, BASE).avatarUrl, '')
})

test('uploadAvatar：PUT /me/avatar 带 base64 负载，成功后用返回 user 刷新状态', async () => {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown>; auth: string | null }> = []
  const auth = new AuthService({
    storage: memoryStorage(),
    baseUrl: BASE,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/auth/login')) {
        return jsonResponse({
          user: { username: 'linyan', nickname: '林岩', avatarUrl: '' },
          token: 'tok-1',
          library: { likedSongs: [], userPlaylists: [], themeMode: 'light' },
        })
      }
      if (url.endsWith('/me/avatar')) {
        calls.push({
          url,
          method: String(init?.method),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          auth: (init?.headers as Record<string, string>)['Authorization'] ?? null,
        })
        return jsonResponse({
          user: { username: 'linyan', nickname: '林岩', avatarUrl: '/uploads/avatars/u1.jpg' },
        })
      }
      throw new Error(`unexpected url ${url}`)
    }) as typeof fetch,
  })

  await auth.login('linyan', 'pw')
  assert.equal(auth.user?.avatarUrl, '')

  await auth.uploadAvatar('aGVsbG8=', 'image/jpeg')
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.method, 'PUT')
  assert.equal(calls[0]?.auth, 'Bearer tok-1')
  assert.equal(calls[0]?.body['mimeType'], 'image/jpeg')
  assert.equal(calls[0]?.body['imageBase64'], 'aGVsbG8=')
  // 状态刷新：新头像 URL 已按 baseUrl 解析
  assert.equal(auth.user?.avatarUrl, 'http://60.205.218.90:8787/uploads/avatars/u1.jpg')
})

test('未登录时 uploadAvatar 直接抛 401（不发请求）', async () => {
  let called = false
  const auth = new AuthService({
    storage: memoryStorage(),
    baseUrl: BASE,
    fetchImpl: (async () => {
      called = true
      return jsonResponse({})
    }) as typeof fetch,
  })
  await assert.rejects(() => auth.uploadAvatar('eA==', 'image/png'), ApiError)
  assert.equal(called, false)
})
