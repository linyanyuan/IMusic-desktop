// 登录 → 音乐库同步 —— 回归锚点：登录后云端收藏/歌单没同步下来。
//
// Dart 端 AuthNotifier.login 会把响应里的 library 通过
// libraryProvider.setLibraryFromLogin(...) 灌进本地库，登出调 clearAccountLibrary()。
// electron-app 早期把 AuthService 建出来时**没传**这两个回调（runtime.ts 未接线），
// 于是 UI 显示「登录成功，已同步云端歌单」但库里其实一首都没有。

import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthService, AUTH_TOKEN_KEY } from '../src/services/auth'
import type { RemoteLibrary } from '../src/services/library'
import type { KeyValueStorage } from '../src/services/storage'

/** 内存版 storage（避免测试触碰 localStorage） */
function memoryStorage(): KeyValueStorage & { dump: () => Record<string, string> } {
  const map = new Map<string, string>()
  return {
    getString: (k) => map.get(k) ?? null,
    setString: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
    getStringList: () => [],
    setStringList: () => {},
    dump: () => Object.fromEntries(map),
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const LIBRARY: RemoteLibrary = {
  likedSongs: [{ id: 'gdstudio:netease:1', title: '云端收藏' }],
  userPlaylists: [{ id: 'p1', name: '云端歌单', songs: [] }],
  themeMode: 'light',
} as unknown as RemoteLibrary

test('登录响应带 library 时，通过回调把云端库灌进本地（等价 setLibraryFromLogin）', async () => {
  let applied: RemoteLibrary | null = null
  const auth = new AuthService({
    storage: memoryStorage(),
    onLibraryFromLogin: (lib) => {
      applied = lib
    },
    fetchImpl: (async () =>
      jsonResponse({
        token: 'tok_1',
        user: { id: 1, username: 'u', nickname: '昵称' },
        library: LIBRARY,
      })) as unknown as typeof fetch,
  })

  await auth.login('u', 'p')
  assert.notEqual(applied, null, '必须把响应里的库交给 library 服务')
  assert.equal((applied as unknown as RemoteLibrary).likedSongs.length, 1)
  assert.equal(auth.isLoggedIn, true)
})

test('注册同样应用 library 回调', async () => {
  let applied = 0
  const auth = new AuthService({
    storage: memoryStorage(),
    onLibraryFromLogin: () => {
      applied += 1
    },
    fetchImpl: (async () =>
      jsonResponse({ token: 'tok_2', user: { id: 2, username: 'n' }, library: LIBRARY })) as unknown as typeof fetch,
  })
  await auth.register('n', 'p')
  assert.equal(applied, 1)
})

test('响应没带 library 时不回调（由调用方兜底 loadLibrary）', async () => {
  let called = false
  const auth = new AuthService({
    storage: memoryStorage(),
    onLibraryFromLogin: () => {
      called = true
    },
    fetchImpl: (async () => jsonResponse({ token: 'tok_3', user: { id: 3, username: 'x' } })) as unknown as typeof fetch,
  })
  await auth.login('x', 'p')
  assert.equal(called, false)
  assert.equal(auth.isLoggedIn, true, '没有 library 也必须算登录成功')
})

test('登录失败：抛出可读错误且不进入登录态、不回调', async () => {
  let called = false
  const auth = new AuthService({
    storage: memoryStorage(),
    onLibraryFromLogin: () => {
      called = true
    },
    fetchImpl: (async () => jsonResponse({ error: '用户名或密码错误' }, 401)) as unknown as typeof fetch,
  })
  await assert.rejects(() => auth.login('x', 'bad'))
  assert.equal(auth.isLoggedIn, false)
  assert.equal(called, false)
})

test('登出调用 clearAccountLibrary 回调，并清掉持久化 token', async () => {
  const storage = memoryStorage()
  let cleared = 0
  const auth = new AuthService({
    storage,
    onAccountLibraryCleared: () => {
      cleared += 1
    },
    fetchImpl: (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/auth/login')) {
        return jsonResponse({ token: 'tok_4', user: { id: 4, username: 'u' }, library: LIBRARY })
      }
      return jsonResponse({}, 200)
    }) as unknown as typeof fetch,
  })

  await auth.login('u', 'p')
  assert.equal(storage.dump()[AUTH_TOKEN_KEY], 'tok_4')

  await auth.logout()
  assert.equal(cleared, 1, '登出必须清空账号库（否则会残留上一个账号的收藏）')
  assert.equal(auth.isLoggedIn, false)
  assert.equal(storage.dump()[AUTH_TOKEN_KEY], undefined, 'token 必须从存储里移除')
})

test('启动恢复：token 失效时清除 token，不进入登录态', async () => {
  const storage = memoryStorage()
  storage.setString(AUTH_TOKEN_KEY, 'stale')
  const auth = new AuthService({
    storage,
    fetchImpl: (async () => jsonResponse({ error: 'Unauthorized' }, 401)) as unknown as typeof fetch,
  })
  await auth.restoreStoredAuth()
  assert.equal(auth.isLoggedIn, false)
  assert.equal(storage.dump()[AUTH_TOKEN_KEY], undefined)
})

test('启动恢复：token 有效时进入登录态', async () => {
  const storage = memoryStorage()
  storage.setString(AUTH_TOKEN_KEY, 'good')
  const auth = new AuthService({
    storage,
    fetchImpl: (async () =>
      jsonResponse({ user: { id: 9, username: 'me', nickname: '我' } })) as unknown as typeof fetch,
  })
  await auth.restoreStoredAuth()
  assert.equal(auth.isLoggedIn, true)
  assert.equal(auth.user?.nickname, '我')
})
