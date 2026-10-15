// 网易云公开接口客户端 —— 映射 / 补全 / 缓存 / 去重回归锚点。
//
// 覆盖三类真实坑：
//   1. 未登录时 playlist/detail 只回传前 10 首 tracks，完整列表在 trackIds 里，
//      必须用 song/detail 分批补齐（否则歌单只显示 10 首）。
//   2. 网易图床回 http://，渲染层 CSP 只放 https（http 封面会被拒 → 封面全空）。
//   3. 歌曲 id 必须是 `gdstudio:netease:<mediaId>` 形状，Hybrid 的 GDStudio
//      取链/歌词分支才能直接用（否则点歌后不出声）。

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NeteasePublicClient,
  interleaveSongs,
  lightShuffle,
} from '../src/services/netease'

interface MockRoute {
  test: (url: string) => boolean
  body: unknown
  status?: number
}

function mockFetch(routes: MockRoute[]): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const impl = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const route = routes.find((item) => item.test(url))
    if (route == null) {
      return new Response('not found', { status: 404 })
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { impl, calls }
}

function track(id: number, name: string, artists: string[] = ['A', 'B']) {
  return {
    id,
    name,
    ar: artists.map((artist) => ({ name: artist })),
    al: { name: '专辑', picUrl: `http://p1.music.126.net/${id}.jpg` },
    dt: 200000 + id,
  }
}

const LIST_BODY = {
  code: 200,
  total: 2557,
  more: true,
  playlists: [
    {
      id: 13007986645,
      name: '欧美热播2024',
      coverImgUrl: 'http://p1.music.126.net/cover.jpg?thumbnail=800y800',
      trackCount: 48,
      playCount: 613846,
      creator: { nickname: '网易云音乐' },
    },
    { id: 456, name: '没有封面的歌单', coverImgUrl: '', trackCount: 0, creator: {} },
    { id: 0, name: '', coverImgUrl: '', trackCount: 1, creator: {} }, // 无名条目应被丢弃
  ],
}

test('分类歌单列表：id 前缀、http→https、创建者字段，并命中缓存', async () => {
  const { impl, calls } = mockFetch([
    { test: (url) => url.includes('/api/playlist/list'), body: LIST_BODY },
  ])
  const client = new NeteasePublicClient({ fetchImpl: impl, timeoutMs: 2000 })

  const rows = await client.getCategoryPlaylists('流行', { limit: 20, offset: 0 })
  assert.equal(rows.length, 2, '无名条目应被丢弃')
  assert.equal(rows[0]['id'], 'netease-playlist:13007986645')
  assert.equal(rows[0]['resultType'], 'playlist')
  assert.equal(rows[0]['title'], '欧美热播2024')
  assert.equal(rows[0]['subtitle'], '网易云音乐')
  assert.equal(rows[0]['artist'], '网易云音乐')
  assert.equal(
    rows[0]['coverUrl'],
    'https://p1.music.126.net/cover.jpg?thumbnail=800y800',
    'http 封面必须升到 https（CSP 只放 https）',
  )
  assert.equal(rows[0]['songCount'], 48)
  assert.equal(rows[0]['playCount'], 613846)
  assert.equal(rows[0]['sourceLabel'], '网易云')
  assert.equal(rows[1]['coverUrl'], undefined)

  // 第二次同样参数不再发请求（TTL 内命中内存缓存）
  await client.getCategoryPlaylists('流行', { limit: 20, offset: 0 })
  assert.equal(calls.length, 1, 'TTL 内应命中缓存')
})

test('分类歌单列表：请求 URL 带上 cat/order/limit/offset', async () => {
  const { impl, calls } = mockFetch([{ test: () => true, body: LIST_BODY }])
  const client = new NeteasePublicClient({ fetchImpl: impl, timeoutMs: 2000 })
  await client.getCategoryPlaylists('R&B/Soul', { limit: 3, offset: 6 })
  assert.equal(calls.length, 1)
  assert.ok(calls[0].includes('/api/playlist/list?cat=R%26B%2FSoul&order=hot&limit=3&offset=6'), calls[0])
})

test('歌单详情：tracks 不足时按 trackIds 顺序用 song/detail 补全', async () => {
  const detailBody = {
    code: 200,
    playlist: {
      name: '测试歌单',
      coverImgUrl: 'http://p1.music.126.net/detail.jpg',
      playCount: 12345,
      creator: { nickname: '阿云' },
      tracks: [track(1, '歌一')],
      trackIds: [{ id: 1 }, { id: 2 }, { id: 3 }],
    },
  }
  const detailRoutes: MockRoute[] = [
    { test: (url) => url.includes('/api/v6/playlist/detail'), body: detailBody },
    {
      test: (url) => url.includes('/api/v3/song/detail'),
      body: { code: 200, songs: [track(2, '歌二'), track(3, '歌三')] },
    },
  ]
  const { impl, calls } = mockFetch(detailRoutes)
  const client = new NeteasePublicClient({ fetchImpl: impl, timeoutMs: 2000 })

  const playlist = await client.getPlaylist('netease-playlist:99')
  assert.equal(playlist['id'], 'netease-playlist:99')
  assert.equal(playlist['title'], '测试歌单')
  assert.equal(playlist['artist'], '阿云')
  assert.equal(playlist['coverUrl'], 'https://p1.music.126.net/detail.jpg')
  assert.equal(playlist['songCount'], 3)

  const songs = playlist['songs'] as Record<string, unknown>[]
  assert.deepEqual(
    songs.map((song) => song['title']),
    ['歌一', '歌二', '歌三'],
    '曲目顺序必须按 trackIds',
  )
  assert.equal(songs[0]['id'], 'gdstudio:netease:1', 'id 必须是 GDStudio netease 形状')
  assert.equal(songs[0]['artist'], 'A / B', '多歌手用 " / " 连接')
  assert.equal(songs[0]['album'], '专辑')
  assert.equal(songs[0]['coverUrl'], 'https://p1.music.126.net/1.jpg')
  assert.equal(songs[0]['duration'], 200001)
  assert.equal(songs[0]['source'], 'netease')
  assert.equal(songs[0]['sourceLabel'], '网易云')
  assert.equal(songs[0]['source'], songs[0]['gdstudioSource'])
  assert.equal(songs[0]['source'], songs[0]['playbackSource'])
  assert.equal(songs[0]['url_id'], '1')
  assert.equal(songs[0]['lyric_id'], '1')
  assert.equal(songs[0]['preferDirectUrl'], true)

  const songDetailCall = calls.find((url) => url.includes('/api/v3/song/detail'))
  assert.ok(songDetailCall != null, '必须调用 song/detail 补全')
  assert.ok(songDetailCall.includes(encodeURIComponent('"id":2')), songDetailCall)
  assert.ok(!songDetailCall.includes(encodeURIComponent('"id":1')), '已有的 tracks 不应重复拉取')

  // 详情也命中缓存：第二次只有 1 次 detail 请求
  const before = calls.filter((url) => url.includes('/api/v6/playlist/detail')).length
  await client.getPlaylist('netease-playlist:99')
  assert.equal(
    calls.filter((url) => url.includes('/api/v6/playlist/detail')).length,
    before,
    'TTL 内应命中详情缓存',
  )
})

test('歌单详情：limit 只截断返回的曲目', async () => {
  const detailBody = {
    code: 200,
    playlist: {
      name: '截断',
      coverImgUrl: '',
      creator: {},
      tracks: [track(1, 'a'), track(2, 'b')],
      trackIds: [{ id: 1 }, { id: 2 }],
    },
  }
  const { impl } = mockFetch([{ test: () => true, body: detailBody }])
  const client = new NeteasePublicClient({ fetchImpl: impl, timeoutMs: 2000 })
  const playlist = await client.getPlaylist('netease-playlist:1', 1)
  assert.equal((playlist['songs'] as unknown[]).length, 1)
})

test('非法歌单 id 直接抛错（不发出请求）', async () => {
  const { impl, calls } = mockFetch([{ test: () => true, body: {} }])
  const client = new NeteasePublicClient({ fetchImpl: impl, timeoutMs: 2000 })
  await assert.rejects(() => client.getPlaylist('bilibili:BV1'), /非法网易云歌单 id/)
  assert.deepEqual(calls, [])
  assert.equal(NeteasePublicClient.isNeteasePlaylistId('netease-playlist:1'), true)
  assert.equal(NeteasePublicClient.isNeteasePlaylistId('bilibili:BV1'), false)
  assert.equal(NeteasePublicClient.rawPlaylistId('netease-playlist:42'), '42')
  assert.equal(NeteasePublicClient.rawPlaylistId('netease-playlist:'), '')
})

test('分类热门单曲：取该分类第 N 批歌单并交错去重', async () => {
  const playlistList = {
    code: 200,
    playlists: [
      { id: 1, name: 'A', trackCount: 2, creator: { nickname: 'u' } },
      { id: 2, name: 'B', trackCount: 2, creator: { nickname: 'u' } },
      { id: 3, name: 'C', trackCount: 2, creator: { nickname: 'u' } },
    ],
  }
  const detailFor = (ids: number[]) => ({
    code: 200,
    playlist: {
      name: 'x',
      coverImgUrl: '',
      creator: {},
      tracks: ids.map((id) => track(id, `歌${id}`)),
      trackIds: ids.map((id) => ({ id })),
    },
  })
  const { impl, calls } = mockFetch([
    { test: (url) => url.includes('/api/playlist/list'), body: playlistList },
    { test: (url) => url.includes('id=1&'), body: detailFor([1, 2]) },
    // 歌单 2 与歌单 1 重复一首（id=2）
    { test: (url) => url.includes('id=2&'), body: detailFor([2, 3]) },
    { test: (url) => url.includes('id=3&'), body: detailFor([4, 5]) },
  ])
  const client = new NeteasePublicClient({ fetchImpl: impl, timeoutMs: 2000 })

  const songs = await client.getCategorySongs('流行', 1)
  const ids = songs.map((song) => song['id'])
  assert.equal(new Set(ids).size, ids.length, 'id 必须唯一')
  assert.equal(ids.length, 5, '6 首歌里重复的 id=2 应被去掉，只剩 5 首')
  assert.ok(ids.includes('gdstudio:netease:1'))
  assert.ok(ids.includes('gdstudio:netease:4'))
  assert.ok(songs.length <= 30)

  assert.ok(
    calls.some((url) => url.includes('limit=3&offset=0')),
    '第一页应请求 3 个歌单、offset=0',
  )
})

test('分类热门单曲：第 2 批翻到 offset=3', async () => {
  const { impl, calls } = mockFetch([
    { test: (url) => url.includes('/api/playlist/list'), body: { code: 200, playlists: [] } },
  ])
  const client = new NeteasePublicClient({ fetchImpl: impl, timeoutMs: 2000 })
  assert.deepEqual(await client.getCategorySongs('流行', 2), [])
  assert.ok(calls[0].includes('offset=3'), calls[0])
})

test('interleaveSongs：按来源轮询交错，并按 id 与「标题+歌手」去重', () => {
  const a = [
    { id: 'a1', title: 'T1', artist: 'X' },
    { id: 'a2', title: 'T2', artist: 'X' },
  ]
  const b = [
    { id: 'a2', title: 'T2', artist: 'X' }, // 同 id 重复
    { id: 'b1', title: 'T1', artist: 'X' }, // 同「标题+歌手」重复
  ]
  const merged = interleaveSongs([a, b], 30)
  assert.deepEqual(
    merged.map((song) => song['id']),
    ['a1', 'a2'],
  )
  assert.deepEqual(
    interleaveSongs([[{ id: 'x1' }], [{ id: 'y1' }]], 30).map((song) => song['id']),
    ['x1', 'y1'],
  )
  assert.equal(interleaveSongs([a, b], 1).length, 1, 'limit 必须生效')
})

test('lightShuffle：相邻换位（不引入随机，可复现）', () => {
  assert.deepEqual(
    lightShuffle([{ id: '1' }, { id: '2' }, { id: '3' }]).map((song) => song['id']),
    ['2', '1', '3'],
  )
})
