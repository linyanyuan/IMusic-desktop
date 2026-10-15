// Hybrid 的网易云路由 + 口味个性化推荐 —— 回归锚点。
//
// 1. `netease-playlist:` 前缀必须走 NeteasePublicClient（否则会被当成 B 站 id
//    送进 BilibiliMusicProvider，表现是分类歌单点进去「歌单不存在」）。
// 2. getPersonalizedSongs 要对每个已选分类取同一页「分类热门单曲」，按分类轮询
//    交错、去重后取 30 首；全部为空/失败时必须回退默认推荐 feed（页面不能空着）。

import assert from 'node:assert/strict'
import test from 'node:test'
import { HybridMusicProvider } from '../src/services/hybrid'
import { MusicService } from '../src/services/musicService'
import { GdStudioMusicClient } from '../src/services/gdstudio'
import { NeteasePublicClient } from '../src/services/netease'
import { playbackUrl } from '../src/services/models'
import type { MusicProvider, RawSong } from '../src/services/musicProvider'

function fakeProvider(songs: RawSong[]): MusicProvider {
  return {
    searchSongs: () => Promise.resolve(songs),
    getRecommendedSongs: () => Promise.resolve(songs),
    getHotPlaylists: () => Promise.resolve([]),
    getPlaylist: () => Promise.resolve({ id: 'fake', title: 'fake', songs }),
    getSongDetail: () => Promise.resolve(songs[0] ?? { id: '' }),
    getPlayUrl: () => Promise.resolve(playbackUrl('')),
  }
}

function makeHybrid(opts: {
  metadata?: MusicProvider
  playback?: MusicProvider
  netease?: NeteasePublicClient
}): HybridMusicProvider {
  return new HybridMusicProvider(
    opts.metadata ?? fakeProvider([]),
    opts.playback ?? fakeProvider([]),
    new GdStudioMusicClient(),
    () => null,
    opts.netease ??
      new NeteasePublicClient({
        fetchImpl: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
      }),
  )
}

test('netease-playlist: 前缀走网易云客户端，歌曲 id 是 GDStudio netease 形状', async () => {
  const calls: string[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    return new Response(
      JSON.stringify({
        code: 200,
        playlist: {
          name: '分类歌单',
          coverImgUrl: 'http://p1.music.126.net/x.jpg',
          creator: { nickname: 'u' },
          tracks: [
            {
              id: 2144901835,
              name: 'Espresso',
              ar: [{ name: 'Sabrina Carpenter' }],
              al: { name: 'Espresso', picUrl: 'http://p1.music.126.net/a.jpg' },
              dt: 175459,
            },
          ],
          trackIds: [{ id: 2144901835 }],
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch

  const hybrid = makeHybrid({ netease: new NeteasePublicClient({ fetchImpl, timeoutMs: 2000 }) })
  const playlist = await hybrid.getPlaylist('netease-playlist:13007986645')

  assert.equal(playlist['title'], '分类歌单')
  assert.equal(playlist['coverUrl'], 'https://p1.music.126.net/x.jpg')
  assert.ok(
    calls.some((url) => url.includes('music.163.com/api/v6/playlist/detail')),
    `必须打到网易云详情接口，实际: ${calls.join(', ')}`,
  )
  const songs = playlist['songs'] as RawSong[]
  assert.equal(songs.length, 1)
  assert.equal(songs[0]['id'], 'gdstudio:netease:2144901835')
  assert.equal(songs[0]['title'], 'Espresso')
  assert.equal(songs[0]['artist'], 'Sabrina Carpenter')
  assert.equal(playlist['resultType'], 'playlist')
})

test('个性化推荐：按已选分类轮询交错并去重，分类 key 映射到真实网易分类名', async () => {
  const seen: string[] = []
  const stub = {
    getCategorySongs: (cat: string, page: number) => {
      seen.push(`${cat}:${page}`)
      if (cat === '流行') {
        return Promise.resolve([
          { id: 'gdstudio:netease:1', title: 'P1', artist: 'a' },
          { id: 'gdstudio:netease:2', title: 'P2', artist: 'a' },
        ])
      }
      return Promise.resolve([
        { id: 'gdstudio:netease:1', title: 'P1', artist: 'a' }, // 同 id 重复
        { id: 'gdstudio:netease:3', title: 'R1', artist: 'b' },
        { id: 'gdstudio:netease:4', title: 'P2', artist: 'a' }, // 「标题+歌手」重复
      ])
    },
  } as unknown as NeteasePublicClient

  const hybrid = makeHybrid({ netease: stub })
  const songs = await hybrid.getPersonalizedSongs(['pop', 'rock'], 2)

  assert.deepEqual(seen, ['流行:2', '摇滚:2'], 'genre key 必须映射成真实分类名，page 透传')
  assert.deepEqual(
    songs.map((song) => song['id']),
    ['gdstudio:netease:1', 'gdstudio:netease:2', 'gdstudio:netease:3'],
    '按分类轮询交错，同 id 与「标题+歌手」都要去重',
  )
})

test('个性化推荐：分类全空时回退默认推荐 feed', async () => {
  const stub = {
    getCategorySongs: () => Promise.resolve([]),
  } as unknown as NeteasePublicClient
  const metadata = fakeProvider([{ id: 'meting:1', title: '默认推荐', artist: 'x' }])
  const hybrid = makeHybrid({ metadata, netease: stub })

  const songs = await hybrid.getPersonalizedSongs(['pop'], 1)
  assert.deepEqual(
    songs.map((song) => song['id']),
    ['meting:1'],
    '分类无内容时必须回退 getRecommendedSongs',
  )
})

test('个性化推荐：未知 genre key 不请求分类，直接回退默认推荐', async () => {
  const seen: string[] = []
  const stub = {
    getCategorySongs: (cat: string) => {
      seen.push(cat)
      return Promise.resolve([{ id: 'netease-only', title: 'x', artist: 'y' }])
    },
  } as unknown as NeteasePublicClient
  const metadata = fakeProvider([{ id: 'meting:2', title: '默认推荐', artist: 'x' }])
  const hybrid = makeHybrid({ metadata, netease: stub })

  const songs = await hybrid.getPersonalizedSongs(['nope'], 1)
  assert.deepEqual(seen, [], '未知 key 不应产生请求')
  assert.deepEqual(songs.map((song) => song['id']), ['meting:2'])
})

test('MusicService：netease-playlist / gdstudio:netease 的 id 不被空载荷过滤误删', async () => {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/api/playlist/list')) {
      return json({
        code: 200,
        playlists: [{ id: 1, name: 'A', trackCount: 1, creator: { nickname: 'u' } }],
      })
    }
    return json({
      code: 200,
      playlist: {
        name: 'A',
        coverImgUrl: '',
        creator: {},
        tracks: [],
        trackIds: [{ id: 2 }],
      },
    })
  }) as unknown as typeof fetch

  const service = new MusicService(
    makeHybrid({ netease: new NeteasePublicClient({ fetchImpl, timeoutMs: 2000 }) }),
  )
  const playlists = await service.getCategoryPlaylists('流行', { limit: 1 })
  assert.deepEqual(
    playlists.map((playlist) => playlist['id']),
    ['netease-playlist:1'],
    '分类歌单 id 不能被 dropUnplayableSongs 丢掉',
  )
  // song/detail 未提供曲目，此时歌单为空但整条请求链路仍成立
  assert.deepEqual(await service.getCategorySongs('流行', 1), [])
})

test('MusicService：非 Hybrid provider 时个性化与分类接口安全降级', async () => {
  const provider = fakeProvider([{ id: 'plain', title: 't', artist: 'a' }])
  const service = new MusicService(provider)

  assert.deepEqual(await service.getCategoryPlaylists('流行'), [])
  assert.deepEqual(await service.getCategorySongs('流行', 1), [])
  // 非 Hybrid 时个性化回退到 getRecommendedSongs
  assert.deepEqual(
    (await service.getPersonalizedSongs(['pop'], 1)).map((song) => song['id']),
    ['plain'],
  )
})
