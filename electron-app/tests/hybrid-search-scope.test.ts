// 「B站歌单」搜索范围（MusicSearchScope.BilibiliPlaylists）的回归锚点。
//
// 用户口径（有意偏离 Dart）：选「B站歌单」时既要搜到歌单，也要能搜到 B站歌曲 ——
// Flutter 原版 searchBilibiliPlaylists 只保留 playlist，这里主动放宽。
// 但追加的「<query> 歌单」扩展查询仍然只收歌单，否则会混进一堆标题含「歌单」的歌。

import assert from 'node:assert/strict'
import test from 'node:test'
import { HybridMusicProvider } from '../src/services/hybrid'
import { GdStudioMusicClient } from '../src/services/gdstudio'
import { NeteasePublicClient } from '../src/services/netease'
import { playbackUrl } from '../src/services/models'
import type { MusicProvider, RawSong } from '../src/services/musicProvider'

interface RecordedCall {
  query: string
  page: number
}

/** 假 provider：按 query 决定返回内容，并记录每次 searchSongs 的 (query, page)。 */
function recordingProvider(
  handler: (query: string, page: number) => RawSong[],
  calls: RecordedCall[] = [],
): MusicProvider {
  return {
    searchSongs: (query: string, page = 1) => {
      calls.push({ query, page })
      return Promise.resolve(handler(query, page))
    },
    getRecommendedSongs: () => Promise.resolve([]),
    getHotPlaylists: () => Promise.resolve([]),
    getPlaylist: () => Promise.resolve({ id: 'fake', title: 'fake', songs: [] }),
    getSongDetail: () => Promise.resolve({ id: '' }),
    getPlayUrl: () => Promise.resolve(playbackUrl('')),
  }
}

function makeHybrid(opts: {
  metadata?: MusicProvider
  playback?: MusicProvider
}): HybridMusicProvider {
  return new HybridMusicProvider(
    opts.metadata ?? recordingProvider(() => []),
    opts.playback ?? recordingProvider(() => []),
    new GdStudioMusicClient(),
    () => null,
    new NeteasePublicClient({
      fetchImpl: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
    }),
  )
}

const ids = (results: RawSong[]) => results.map((item) => item['id'])

test('B站歌单范围：主查询的 B站歌曲与歌单都进结果', async () => {
  const playback = recordingProvider(() => [
    { id: 'bilibili:BV1', resultType: 'song', title: '歌' },
    { id: 'bilibili:pl1', resultType: 'playlist', title: '单' },
  ])
  const hybrid = makeHybrid({ playback })

  const results = await hybrid.searchBilibiliPlaylists('周杰伦', 1)

  assert.deepEqual(ids(results), ['bilibili:BV1', 'bilibili:pl1'])
  assert.equal(results[0]['resultType'], 'song', '非 playlist 的条目也必须保留')
  assert.equal(results[1]['resultType'], 'playlist')
})

test('B站歌单范围：按 id 去重（跨主查询与扩展查询）', async () => {
  const playback = recordingProvider((query) =>
    query.endsWith('歌单')
      ? [
          { id: 'bilibili:pl1', resultType: 'playlist', title: '单' },
          { id: 'bilibili:pl2', resultType: 'playlist', title: '单2' },
        ]
      : [
          { id: 'bilibili:BV1', resultType: 'song', title: '歌' },
          { id: 'bilibili:BV1', resultType: 'song', title: '歌重复' },
          { id: 'bilibili:pl1', resultType: 'playlist', title: '单' },
        ],
  )
  const hybrid = makeHybrid({ playback })

  const results = await hybrid.searchBilibiliPlaylists('周杰伦', 1)

  assert.deepEqual(ids(results), ['bilibili:BV1', 'bilibili:pl1', 'bilibili:pl2'])
})

test('B站歌单范围：「歌单」扩展查询只补歌单，不混入歌曲', async () => {
  const playback = recordingProvider((query) =>
    query.endsWith('歌单')
      ? [
          { id: 'bilibili:BV9', resultType: 'song', title: '带歌单标题的歌' },
          { id: 'bilibili:pl9', resultType: 'playlist', title: '真歌单' },
        ]
      : [],
  )
  const hybrid = makeHybrid({ playback })

  const results = await hybrid.searchBilibiliPlaylists('周杰伦', 1)

  assert.deepEqual(ids(results), ['bilibili:pl9'])
})

test('B站歌单范围：扩展查询只在第一页发起', async () => {
  const calls: RecordedCall[] = []
  const playback = recordingProvider(
    () => [{ id: 'bilibili:pl1', resultType: 'playlist', title: '单' }],
    calls,
  )
  const hybrid = makeHybrid({ playback })

  await hybrid.searchBilibiliPlaylists('周杰伦', 2)

  assert.deepEqual(calls, [{ query: '周杰伦', page: 2 }], '第 2 页不应再发「歌单」扩展请求')
})

test('B站歌单范围：不掺元数据歌曲（metadata provider 不被调用）', async () => {
  const metadataCalls: RecordedCall[] = []
  const metadata = recordingProvider(
    () => [{ id: 'meting:1', title: '元数据歌', artist: 'x' }],
    metadataCalls,
  )
  const playback = recordingProvider(() => [
    { id: 'bilibili:BV1', resultType: 'song', title: '歌' },
  ])
  const hybrid = makeHybrid({ metadata, playback })

  const results = await hybrid.searchBilibiliPlaylists('周杰伦', 1)

  assert.deepEqual(metadataCalls, [], '该范围只走 B站播放源头')
  assert.deepEqual(ids(results), ['bilibili:BV1'])
})

test('B站歌单范围：page < 1 归一成第一页（扩展查询照常发起）', async () => {
  const calls: RecordedCall[] = []
  const playback = recordingProvider(
    (query) => [{ id: `bilibili:${query.endsWith('歌单') ? 'pl2' : 'pl1'}`, resultType: 'playlist' }],
    calls,
  )
  const hybrid = makeHybrid({ playback })

  await hybrid.searchBilibiliPlaylists('周杰伦', 0)

  assert.deepEqual(
    calls,
    [
      { query: '周杰伦', page: 1 },
      { query: '周杰伦 歌单', page: 1 },
    ],
    'page 0 必须当作第 1 页，扩展查询才会发起',
  )
})
