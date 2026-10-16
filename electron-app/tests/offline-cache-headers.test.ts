// 离线缓存下载请求头合并（src/state/offlineCache.ts chainDownloadHeaders）回归锚点。
//
// 真 bug：cacheSong 曾把 getPlayUrl 的 PlaybackUrl.headers 丢掉，只用基于 Song 的
// 启发式头。对「元数据 source 是 netease/qqmusic、实际解析到 B 站 CDN」的 hybrid 歌曲
// （meting id、ChKSz 回落），启发式返回 {} → 主进程下载 403 → 静默缓存失败。
// 这里的四条断言锁定：provider 头为准、启发式兜底不丢、provider 同名键胜出、null 不炸。

import assert from 'node:assert/strict'
import test from 'node:test'
import { chainDownloadHeaders, downloadHeadersFor } from '../src/state/offlineCache'
import type { Song } from '../src/services/models'

/** 构造一个最小可用 Song（只关心 id / source 的 B 站判定） */
function makeSong(patch: Partial<Song>): Song {
  return {
    id: 'netease:123456',
    title: '测试歌曲',
    artist: '测试歌手',
    source: 'netease',
    duration: '3:00',
    resultType: 'song',
    songCount: 0,
    isFavorite: false,
    isCached: false,
    extra: {},
    ...patch,
  }
}

const PROVIDER_HEADERS = {
  Referer: 'https://www.bilibili.com/video/BV1xx411c7mD',
  'User-Agent': 'ProviderUA/1.0',
}

test('非 B 站歌 + provider 给了头 → 用 provider 的（hybrid 解析到 B 站 CDN 的场景）', () => {
  const song = makeSong({ id: 'netease:123456', source: 'netease' })
  assert.deepEqual(downloadHeadersFor(song), {}, '前置：启发式对这种歌给不出头（正是原 bug）')

  const headers = chainDownloadHeaders(song, PROVIDER_HEADERS)
  assert.equal(headers.Referer, PROVIDER_HEADERS.Referer)
  assert.equal(headers['User-Agent'], PROVIDER_HEADERS['User-Agent'])
})

test('B 站歌 + provider 头为空/undefined → 仍给启发式的 Referer 与 UA（兜底不能丢）', () => {
  const song = makeSong({ id: 'bilibili:BV1xx411c7mD', source: 'Bilibili' })
  const fallback = downloadHeadersFor(song)
  assert.equal(fallback.Referer, 'https://www.bilibili.com')
  assert.ok((fallback['User-Agent'] ?? '').length > 0)

  for (const provider of [{}, undefined] as const) {
    const headers = chainDownloadHeaders(song, provider)
    assert.deepEqual(headers, fallback)
  }
})

test('B 站歌 + provider 也给了头 → provider 的同名值胜出，且额外键透传', () => {
  const song = makeSong({ id: 'bilibili:BV1xx411c7mD', source: 'Bilibili' })
  const headers = chainDownloadHeaders(song, {
    Referer: 'https://www.bilibili.com/video/BV1xx411c7mD',
    Cookie: 'SESSDATA=abc',
  })
  assert.equal(headers.Referer, 'https://www.bilibili.com/video/BV1xx411c7mD', 'provider 值覆盖启发式')
  assert.equal(headers.Cookie, 'SESSDATA=abc')
  // provider 没给的启发式键保留（UA）
  assert.ok((headers['User-Agent'] ?? '').length > 0)
})

test('providerHeaders 为 null 时不炸（返回启发式结果）', () => {
  const song = makeSong({ id: 'bilibili:BV1xx411c7mD', source: 'Bilibili' })
  assert.deepEqual(chainDownloadHeaders(song, null), downloadHeadersFor(song))

  const plain = makeSong({ id: 'netease:123456', source: 'netease' })
  assert.deepEqual(chainDownloadHeaders(plain, null), {})
})
