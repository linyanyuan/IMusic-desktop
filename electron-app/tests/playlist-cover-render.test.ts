// 自建歌单封面的渲染兜底 —— 回归锚点：已有歌单（老数据）永远没有 coverUrl。
//
// LibraryService.addSongToPlaylist 只在「首次加歌」时往歌单记录回填 coverUrl
// （契约见 tests/playlist-cover.test.ts），所以那次回填之前就存在的歌单永远没有这个字段，
// 只靠回填修不好用户报的「还是没显示封面」。渲染层因此需要自己兜底：
// 歌单没有 coverUrl 时，退到歌单内第一首带封面的歌；都没有交给 Cover 按 seed 渲染渐变占位。
//
// 纯函数，不依赖 electron / DOM。

import assert from 'node:assert/strict'
import test from 'node:test'
import { playlistCover } from '../src/state/songUtils'

test('歌单自己有 coverUrl → 直接用它（即使 songs 里也有封面）', () => {
  assert.equal(
    playlistCover({
      id: 'p1',
      coverUrl: 'https://img/playlist.jpg',
      songs: [{ coverUrl: 'https://img/song.jpg' }],
    }),
    'https://img/playlist.jpg',
  )
})

test('歌单没有 coverUrl、第一首有 → 返回第一首的封面（用户报的那条）', () => {
  assert.equal(
    playlistCover({
      id: 'p2',
      name: '老歌单',
      songs: [{ coverUrl: 'https://img/first.jpg' }, { coverUrl: 'https://img/second.jpg' }],
    }),
    'https://img/first.jpg',
  )
})

test('第一首没有封面、第二首有 → 返回第二首的', () => {
  assert.equal(
    playlistCover({
      id: 'p3',
      songs: [{ title: '无封面' }, { coverUrl: 'https://img/second.jpg' }],
    }),
    'https://img/second.jpg',
  )
})

test('coverUrl 是空串/纯空白 → 视为没有，继续回退到 songs；返回值 trim', () => {
  assert.equal(
    playlistCover({ id: 'p4', coverUrl: '', songs: [{ coverUrl: 'https://img/s.jpg' }] }),
    'https://img/s.jpg',
  )
  assert.equal(
    playlistCover({ id: 'p5', coverUrl: '   ', songs: [{ coverUrl: 'https://img/s.jpg' }] }),
    'https://img/s.jpg',
  )
  // 命中的封面地址同样 trim 后再返回（与 LibraryService.coverUrlOf 一致）
  assert.equal(
    playlistCover({ id: 'p6', coverUrl: '  https://img/p.jpg  ' }),
    'https://img/p.jpg',
  )
  assert.equal(
    playlistCover({ id: 'p7', songs: [{ coverUrl: '  https://img/s2.jpg  ' }] }),
    'https://img/s2.jpg',
  )
})

test('没有 coverUrl 且 songs 为空数组 → null', () => {
  assert.equal(playlistCover({ id: 'p8', name: '空歌单', songs: [] }), null)
})

test('防御：songs 不是数组 / 元素是 null 或字符串 / 对象缺字段 → 不抛、返回 null', () => {
  assert.equal(playlistCover({ id: 'd1', songs: 'not an array' }), null)
  assert.equal(playlistCover({ id: 'd2', songs: 42 }), null)
  assert.equal(playlistCover({ id: 'd3', songs: null }), null)
  assert.equal(playlistCover({ id: 'd4' }), null)

  assert.equal(playlistCover({ id: 'd5', songs: [null, 'string', 7, {}] }), null)
  assert.equal(playlistCover({ id: 'd6', songs: [null, { coverUrl: 'https://img/ok.jpg' }] }), 'https://img/ok.jpg')

  // coverUrl 字段不是字符串 → 跳过，不抛
  assert.equal(playlistCover({ id: 'd7', coverUrl: 42 }), null)
  assert.equal(playlistCover({ id: 'd8', songs: [{ coverUrl: 42 }, { coverUrl: null }] }), null)
})
