// 自建歌单封面回填 —— 回归锚点：新建的歌单加歌之后仍然永远是一张渐变占位。
//
// createPlaylist 不写 coverUrl，addSongToPlaylist 也不回填，于是 LibraryView /
// Sidebar / PlaylistDetailView 里自建歌单只能是 seed 渐变（收藏/远端歌单有封面，
// 对比之下像坏了）。修复：首次加歌且歌单还没有封面时，把这首歌的封面写进歌单记录。
//
// 不能破坏的点：已有封面的歌单不能被覆盖；收藏（远端）歌单不参与回填。

import assert from 'node:assert/strict'
import test from 'node:test'
import { LibraryService } from '../src/services/library'
import { songFromJson, type Song } from '../src/services/models'
import type { KeyValueStorage } from '../src/services/storage'

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

/** 假的 /library 后端：PUT 原样存下 body，GET/PUT 都返回 {library} */
function setup(playlists: Record<string, unknown>[]) {
  let remote: Record<string, unknown> = {
    likedSongs: [],
    userPlaylists: playlists,
    themeMode: 'light',
  }
  const fetchImpl = (async (_input: unknown, init?: { body?: string }) => {
    if (init?.body != null) {
      remote = JSON.parse(String(init.body)) as Record<string, unknown>
    }
    return new Response(JSON.stringify({ library: remote }), { status: 200 })
  }) as unknown as typeof fetch
  const library = new LibraryService({
    storage: memoryStorage(),
    tokenProvider: () => 'token',
    fetchImpl,
  })
  library.setLibraryFromLogin({ likedSongs: [], userPlaylists: playlists, themeMode: 'light' })
  return { library, remote: () => remote }
}

const song = (json: Record<string, unknown>): Song => songFromJson(json)

test('空自建歌单加入第一首带封面的歌后 coverUrl 被回填（本地与远端一致）', async () => {
  const { library, remote } = setup([
    { id: 'p1', name: '我的歌单', title: '我的歌单', songs: [], isCollected: false },
  ])
  await library.addSongToPlaylist(
    'p1',
    song({ id: 's1', title: '夏天', artist: 'A', coverUrl: 'https://img/1.jpg' }),
  )

  assert.equal(library.playlists[0]['coverUrl'], 'https://img/1.jpg', '本地歌单应回填封面')
  const synced = (remote().userPlaylists as Record<string, unknown>[])[0]
  assert.equal(synced['coverUrl'], 'https://img/1.jpg', 'PUT 到远端的歌单也要带上封面')
})

test('已有 coverUrl 的歌单不被本次加歌覆盖', async () => {
  const { library, remote } = setup([
    {
      id: 'p2',
      name: '已有封面',
      title: '已有封面',
      songs: [],
      isCollected: false,
      coverUrl: 'https://img/orig.jpg',
    },
  ])
  await library.addSongToPlaylist(
    'p2',
    song({ id: 's2', title: '冬天', artist: 'B', coverUrl: 'https://img/new.jpg' }),
  )

  assert.equal(library.playlists[0]['coverUrl'], 'https://img/orig.jpg')
  const synced = (remote().userPlaylists as Record<string, unknown>[])[0]
  assert.equal(synced['coverUrl'], 'https://img/orig.jpg')
})

test('coverUrl 为 null 的旧数据（历史歌单）也能被回填', async () => {
  const { library } = setup([
    { id: 'p3', name: '老歌单', title: '老歌单', songs: [], isCollected: false, coverUrl: null },
  ])
  await library.addSongToPlaylist(
    'p3',
    song({ id: 's3', title: '秋天', artist: 'C', coverUrl: 'https://img/3.jpg' }),
  )

  assert.equal(library.playlists[0]['coverUrl'], 'https://img/3.jpg')
})

test('收藏（远端）歌单不参与封面回填', async () => {
  const { library } = setup([
    { id: 'c1', name: '收藏的歌单', title: '收藏的歌单', songs: [], isCollected: true },
  ])
  await library.addSongToPlaylist(
    'c1',
    song({ id: 's4', title: '春天', artist: 'D', coverUrl: 'https://img/4.jpg' }),
  )

  assert.equal(library.playlists[0]['coverUrl'], undefined)
})

test('加入的歌本身没有封面时不写入空封面', async () => {
  const { library } = setup([
    { id: 'p5', name: '无封面歌单', title: '无封面歌单', songs: [], isCollected: false },
  ])
  await library.addSongToPlaylist('p5', song({ id: 's5', title: '无封面', artist: 'E' }))

  assert.equal(library.playlists[0]['coverUrl'], undefined)
})
