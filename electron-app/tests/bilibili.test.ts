// B 站搜索结果 → Song 映射的回归测试。
//
// 背景（项目记忆 #76/#77）：B 站 search/type 会混入 type=ketang（B站课堂/付费课程）、
// 番剧、影视等没有 bvid 的条目。修复前这些条目被映射成 `bilibili:`（空 bvid），
// 下游取 CID 必然失败 —— 症状是点歌后播控栏有歌名但不出声（Dart 端曾同样中招）。

import assert from 'node:assert/strict'
import test from 'node:test'
import { BilibiliMusicProvider } from '../src/services/bilibili'

/** 用假 fetch 顶掉网络层，返回给定 result 列表 */
function stubFetch(result: unknown[]): { calls: string[]; restore: () => void } {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input))
    return new Response(JSON.stringify({ code: 0, data: { result } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

test('searchSongs 过滤无 bvid 条目，且 id 由 bvid 构成', async () => {
  const stub = stubFetch([
    {
      bvid: 'BV1xx411c7mD',
      title: '<em class="keyword">起风了</em> 原唱',
      author: 'UP主',
      duration: '03:58',
      pic: '//i0.hdslb.com/bfs/archive/cover.jpg',
    },
    // 课堂条目：只有 season id，没有 bvid
    { bvid: '', title: '从零开始学混音', author: '讲师', duration: '10:00', type: 'ketang', season_id: 12345 },
    // 番剧/影视条目同样可能没有 bvid
    { title: '某番剧', author: '番剧', duration: '24:00' },
  ])
  const provider = new BilibiliMusicProvider()
  try {
    const songs = await provider.searchSongs('起风了')
    assert.equal(songs.length, 1, '无 bvid 的条目必须被剔除')
    assert.equal(songs[0].id, 'bilibili:BV1xx411c7mD')
    assert.equal(songs[0].title, '起风了 原唱', '标题要剥掉 <em> 高亮标签')
    assert.equal(songs[0].coverUrl, 'https://i0.hdslb.com/bfs/archive/cover.jpg', '// 开头要补 https:')
    assert.equal(songs[0].duration, 238_000, 'duration 从秒换算成毫秒')
  } finally {
    stub.restore()
  }
})

test('全部条目都没有 bvid 时返回空数组（不产生空载荷 id）', async () => {
  const stub = stubFetch([{ bvid: '', title: '课程', type: 'ketang' }])
  const provider = new BilibiliMusicProvider()
  try {
    const songs = await provider.searchSongs('课程')
    assert.deepEqual(songs, [])
  } finally {
    stub.restore()
  }
})

test('bvid 只有空白字符也算无效', async () => {
  const stub = stubFetch([{ bvid: '   ', title: '空白 bvid', duration: '01:00' }])
  const provider = new BilibiliMusicProvider()
  try {
    assert.deepEqual(await provider.searchSongs('x'), [])
  } finally {
    stub.restore()
  }
})

test('getPlayUrl 对空 bvid fail-fast（不再静默取流失败）', async () => {
  const provider = new BilibiliMusicProvider()
  await assert.rejects(() => provider.getPlayUrl('bilibili:'), /B 站视频 ID 无效/)
})

test('空查询不发请求', async () => {
  const stub = stubFetch([])
  const provider = new BilibiliMusicProvider()
  try {
    assert.deepEqual(await provider.searchSongs('   '), [])
    assert.equal(stub.calls.length, 0)
  } finally {
    stub.restore()
  }
})
