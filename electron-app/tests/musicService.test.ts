// MusicService：空载荷 id 兜底过滤 + scope 分派。
//
// 背景（项目记忆 #77）：provider 层已按来源剔除无 bvid 条目，但 Gateway 推荐、
// 热点歌单等其它来源仍可能吐出 `bilibili:` / `gdstudio::` 这类空 id，
// MusicService 出口再兜一层，避免空 id 流入 UI 与播放链路。

import assert from 'node:assert/strict'
import test from 'node:test'
import { MusicService, createMusicService } from '../src/services/musicService'
import { MusicSearchScope } from '../src/services/models'
import type { MusicProvider, RawSong } from '../src/services/musicProvider'

function song(id: string): RawSong {
  return { id, title: id, artist: 'a', source: 'x', sourceLabel: 'x' } as RawSong
}

/** 最小假 provider：只实现被 MusicService 用到的几个出口 */
function fakeProvider(songs: RawSong[]) {
  const calls: string[] = []
  const provider = {
    searchSongs: (query: string, page = 1) => {
      calls.push(`search:${query}:${page}`)
      return Promise.resolve(songs)
    },
    getRecommendedSongs: () => {
      calls.push('recommended')
      return Promise.resolve(songs)
    },
    getHotPlaylists: () => {
      calls.push('hot')
      return Promise.resolve(songs)
    },
    getPlaylist: () => Promise.resolve(songs[0]),
    getSongDetail: () => Promise.resolve(songs[0]),
    getPlayUrl: () => Promise.resolve({ url: '', br: -1, lyrics: null, resolvedId: null, coverUrl: null }),
  } as unknown as MusicProvider
  return { provider, calls }
}

const MIXED = [
  song('gdstudio:netease:12345'),
  song('bilibili:BV1xx411c7mD'),
  song('bilibili:'),
  song('gdstudio::'),
  song('plain-id-without-colon'),
]

test('searchSongs 丢弃空载荷 id，保留可用 id', async () => {
  const { provider } = fakeProvider(MIXED)
  const service = new MusicService(provider)
  const ids = (await service.searchSongs('周杰伦')).map((s) => s.id)
  assert.deepEqual(ids, ['gdstudio:netease:12345', 'bilibili:BV1xx411c7mD', 'plain-id-without-colon'])
})

test('推荐与热点歌单同样兜底过滤', async () => {
  const { provider } = fakeProvider(MIXED)
  const service = new MusicService(provider)
  assert.equal((await service.getRecommendedSongs()).length, 3)
  assert.equal((await service.getHotPlaylists()).length, 3)
})

test('scope=All 走 provider.searchSongs，MetadataSongs 在非 Hybrid 时也回落同一出口', async () => {
  const { provider, calls } = fakeProvider([song('gdstudio:netease:1')])
  const service = new MusicService(provider)
  await service.searchSongs('q', 2, MusicSearchScope.All)
  await service.searchSongs('q', 3, MusicSearchScope.MetadataSongs)
  assert.deepEqual(calls, ['search:q:2', 'search:q:3'])
})

test('scope=BilibiliPlaylists 在非 Hybrid 时返回空数组（不误报 provider 搜索）', async () => {
  const { provider, calls } = fakeProvider([song('bilibili:BV1')])
  const service = new MusicService(provider)
  assert.deepEqual(await service.searchSongs('q', 1, MusicSearchScope.BilibiliPlaylists), [])
  assert.deepEqual(calls, [])
})

test('scope=ChkszSongs 在未配置 ChKSz 时拒绝而不是静默空列表', async () => {
  const { provider } = fakeProvider([])
  const service = new MusicService(provider)
  await assert.rejects(() => service.searchSongs('q', 1, MusicSearchScope.ChkszSongs), /ChKSz/)
})

test('所有条目都不可播时返回空数组（UI 显示空态而不是空行）', async () => {
  const { provider } = fakeProvider([song('bilibili:'), song('gdstudio:')])
  const service = new MusicService(provider)
  assert.deepEqual(await service.searchSongs('课程'), [])
})

// 回归锚点：metadata 链的主源是 Meting，不是 Bilibili。
// FallbackMusicProvider 默认判定是 `id.startsWith('bilibili:')`，若 createMusicService
// 不覆盖该谓词，meting:* 的歌会被路由到 DefaultMusicProvider（Karpov Gateway），
// 用 meting id 去请求 QQMusic 详情，导致元数据/歌词全丢。
// 对照 Dart 端 music_service.dart 传入的 isPrimaryId。
test('meting:* 的歌详情走 Meting 主源，不落到 Default/Karpov Gateway', async () => {
  const originalFetch = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input))
    return new Response(JSON.stringify({ code: 200, data: { id: 'meting:tencent:abc' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const service = createMusicService({
      tokenProvider: () => '',
      chkszApiKeyProvider: () => '',
      metingBaseUrl: 'http://meting.test/api',
    })
    await service.getSongDetail('meting:tencent:abc')
    assert.ok(
      urls.some((u) => u.startsWith('http://meting.test/api/music/songs/tencent/abc')),
      `详情必须打到 Meting 主源，实际: ${urls.join(', ')}`,
    )
    assert.ok(
      urls.every((u) => !u.includes('karpov')),
      '不得把 meting id 发给 Default provider 的 Gateway',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

// 用户反馈「配置 ChKSz key 后搜索没打通」的回归锚点：
// 修复前 key 在 createMusicService 时就快照了，设置页后填的 key 永远不生效（要重启）。
test('ChKSz：设置页后填的 key 立即可用（无需重建服务/重启）', async () => {
  let key = ''
  const originalFetch = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input))
    return new Response(
      JSON.stringify({
        code: 200,
        msg: 'success',
        data: {
          songs: [
            {
              id: 509781655,
              name: '想你就写信 (Live)',
              artists: '周杰伦/李硕/张鑫',
              album: '中国新歌声第二季 第13期',
              picUrl: 'http://p3.music.126.net/cover.jpg',
              duration: 238300,
            },
          ],
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch

  try {
    const service = createMusicService({
      tokenProvider: () => '',
      chkszApiKeyProvider: () => key,
    })

    await assert.rejects(
      () => service.searchSongs('周杰伦', 1, MusicSearchScope.ChkszSongs),
      /ChKSz/,
      '未配置 key 时必须明确报错而不是静默空列表',
    )
    assert.equal(urls.length, 0, '没有 key 时不应发任何请求')

    key = 'chksz_live_test'
    const songs = await service.searchSongs('周杰伦', 1, MusicSearchScope.ChkszSongs)
    assert.equal(songs.length, 1)
    assert.equal(songs[0].id, 'chksz:163:509781655')
    assert.equal(songs[0].title, '想你就写信 (Live)')
    assert.equal(songs[0].artist, '周杰伦/李硕/张鑫', 'artists 是斜杠字符串')
    assert.equal(songs[0].coverUrl, 'https://p3.music.126.net/cover.jpg', 'http:// 要升级为 https')
    assert.equal(songs[0].duration, 238300)
    assert.ok(
      urls.some((u) => u.includes('apikey=chksz_live_test')),
      '新 key 必须真的带到请求上',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
