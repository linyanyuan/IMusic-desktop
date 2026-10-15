// GDStudio 音源：默认源顺序 + song id 解析。
//
// 背景（项目记忆 #79）：2026-10 上游回归后只有 netease 可用。默认源顺序一旦被
// 「照抄」回 ['joox','kuwo','netease']，搜索会返回 joox 条目、取链为空 ——
// 表现是「播控栏有歌名但不出声」。这里把它钉死成回归断言。

import assert from 'node:assert/strict'
import test from 'node:test'
import { GdStudioMusicClient } from '../src/services/gdstudio'

test('默认源只有 netease（不要再照抄 joox/kuwo）', () => {
  assert.deepEqual([...GdStudioMusicClient.defaultSources], ['netease'])
})

test('parseSongId 解析 gdstudio:{source}:{id}', () => {
  assert.deepEqual(GdStudioMusicClient.parseSongId('gdstudio:netease:12345'), ['netease', '12345'])
  assert.deepEqual(GdStudioMusicClient.parseSongId('gdstudio:netease:abc:def'), [
    'netease',
    'abc:def',
  ])
})

test('parseSongId 拒绝无 source 的旧形态与非法输入（与 Dart 端一致）', () => {
  assert.equal(GdStudioMusicClient.parseSongId('gdstudio:12345'), null)
  assert.equal(GdStudioMusicClient.parseSongId('gdstudio:'), null)
  assert.equal(GdStudioMusicClient.parseSongId('gdstudio:netease:'), null)
  assert.equal(GdStudioMusicClient.parseSongId('bilibili:BV1xx'), null)
  assert.equal(GdStudioMusicClient.parseSongId(''), null)
})

test('buildSongId / isGdStudioId 往返一致', () => {
  const id = GdStudioMusicClient.buildSongId({ source: 'netease', mediaId: '999' })
  assert.equal(id, 'gdstudio:netease:999')
  assert.deepEqual(GdStudioMusicClient.parseSongId(id), ['netease', '999'])
  assert.equal(GdStudioMusicClient.isGdStudioId(id), true)
  assert.equal(GdStudioMusicClient.isGdStudioId('bilibili:BV1xx'), false)
})
