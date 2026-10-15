// 「已喜欢」判定 —— 回归锚点：心动/心形按钮对 B 站分P歌不亮。
//
// 收藏时库会把歌曲补上移动端字段，B 站分P歌进库后 id 变成 `bilibili:BV...:p1`，
// 而当前播放的曲 id 是 `bilibili:BV...`。UI 早期用严格 id 相等判「是否已收藏」：
//   library.likedSongs.some(s => s.id === song.id)
// → 明明已经收藏（云端也确实写入了），心形却仍是空心的；点一下还会把它取消收藏。
// 修复：统一走 LibraryService.isLiked（内部用 songsShareIdentity 身份比较）。
//
// 不能退回严格比较：`bilibili:BV1x:p1` 与 `bilibili:BV1x` 是同一首歌。

import assert from 'node:assert/strict'
import test from 'node:test'
import { LibraryService, songsShareIdentity } from '../src/services/library'
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

/** 建一个已灌入云端收藏的库服务（不触网） */
function serviceWithLiked(liked: Record<string, unknown>[]): LibraryService {
  const library = new LibraryService({
    storage: memoryStorage(),
    tokenProvider: () => '',
    fetchImpl: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
  })
  library.setLibraryFromLogin({ likedSongs: liked, userPlaylists: [], themeMode: 'light' })
  return library
}

const song = (json: Record<string, unknown>): Song => songFromJson(json)

test('B站分P收藏（:p1）能被同曲主的当前播放曲识别为已喜欢', () => {
  const library = serviceWithLiked([
    { id: 'bilibili:BV1pP4y1G7hU:p1', title: '大海', artist: '张雨生', source: 'bilibili' },
  ])
  const current = song({ id: 'bilibili:BV1pP4y1G7hU', title: '大海', artist: '张雨生' })
  assert.equal(
    library.isLiked(current),
    true,
    '严格 id 相等在这里是 false（真实回归），必须走身份比较',
  )
})

test('反向：当前曲带 :p1、库里是不带后缀的 id 也算已喜欢', () => {
  const library = serviceWithLiked([
    { id: 'bilibili:BV1pP4y1G7hU', title: '大海', artist: '张雨生' },
  ])
  assert.equal(library.isLiked(song({ id: 'bilibili:BV1pP4y1G7hU:p1', title: '大海' })), true)
})

test('未收藏的歌返回 false（不能因为宽松比较误报已收藏）', () => {
  const library = serviceWithLiked([
    { id: 'bilibili:BV1pP4y1G7hU:p1', title: '大海' },
  ])
  assert.equal(library.isLiked(song({ id: 'bilibili:BV9999', title: '别的歌' })), false)
  assert.equal(library.isLiked(song({ id: '', title: '空 id' })), false)
})

test('song.isFavorite 为真时直接算已喜欢（不依赖收藏列表）', () => {
  const library = serviceWithLiked([])
  assert.equal(library.isLiked(song({ id: 'bilibili:BV1x', isFavorite: true })), true)
})

test('songsShareIdentity：B站分P id 与非分P id 视为同一首；不同稿件不同首', () => {
  assert.equal(
    songsShareIdentity({ id: 'bilibili:BV1x:p1' }, { id: 'bilibili:BV1x' }),
    true,
  )
  assert.equal(songsShareIdentity({ id: 'bilibili:BV1x:p1' }, { id: 'bilibili:BV1y' }), false)
})
