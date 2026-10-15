// ChKSz 取链（163_music）与「测试连接」——含音质阶梯与错误分类。
//
// 上游两种失败必须区分开：
//   code 404 `Music URL not found, song may be unavailable at this quality level`
//     → 单音质信号，降一档继续试（exhigh 无 → standard）
//   鉴权/限流等业务错误（401 / invalid apikey …）
//     → 系统性错误，立即上抛，由 Hybrid 决定是否回退 B 站

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ChkszApiError,
  ChkszApiKeyMissingError,
  ChkszMusicClient,
  createChkszResolver,
  verifyChkszKey,
} from '../src/services/chksz'

/** 按调用顺序返回预设响应体的假 fetch */
function stubSequence(bodies: unknown[]): { urls: string[]; restore: () => void } {
  const urls: string[] = []
  let index = 0
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input))
    const body = bodies[Math.min(index, bodies.length - 1)]
    index += 1
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { urls, restore: () => { globalThis.fetch = original } }
}

const QUALITY_MISS = {
  code: 404,
  msg: 'Music URL not found, song may be unavailable at this quality level',
}

test('exhigh 无地址时降级到 standard（不因 code 404 直接放弃整条阶梯）', async () => {
  const stub = stubSequence([
    QUALITY_MISS,
    {
      code: 200,
      data: {
        id: 509781655,
        url: 'http://m801.music.126.net/path/song.mp3',
        picUrl: 'http://p1.music.126.net/cover.jpg',
      },
    },
  ])
  try {
    const client = new ChkszMusicClient({ apiKey: 'k' })
    const playback = await client.getPlayUrl('chksz:163:509781655')
    assert.equal(playback.url, 'https://m801.music.126.net/path/song.mp3', 'http 升级为 https')
    assert.equal(playback.coverUrl, 'https://p1.music.126.net/cover.jpg')
    assert.equal(playback.resolvedId, 'chksz:163:509781655')
    assert.equal(stub.urls.length, 2, '应当试了 exhigh 与 standard 两档')
    assert.ok(stub.urls[0].includes('level=exhigh'))
    assert.ok(stub.urls[1].includes('level=standard'))
  } finally {
    stub.restore()
  }
})

test('鉴权错误立即上抛，不再浪费阶梯', async () => {
  const stub = stubSequence([{ code: 401, msg: 'invalid apikey' }])
  try {
    const client = new ChkszMusicClient({ apiKey: 'bad' })
    await assert.rejects(
      () => client.getPlayUrl('chksz:163:1'),
      (e: unknown) => e instanceof ChkszApiError && /invalid apikey/.test((e as Error).message),
    )
    assert.equal(stub.urls.length, 1, '鉴权错误不该继续试下一档')
  } finally {
    stub.restore()
  }
})

test('所有音质都无地址时给出可读错误', async () => {
  const stub = stubSequence([QUALITY_MISS, QUALITY_MISS])
  try {
    const client = new ChkszMusicClient({ apiKey: 'k' })
    await assert.rejects(() => client.getPlayUrl('chksz:163:1'), /未返回播放地址/)
  } finally {
    stub.restore()
  }
})

test('未配置 key 时取链前就抛 ChkszApiKeyMissingError（不发请求）', async () => {
  const stub = stubSequence([{ code: 200, data: {} }])
  try {
    const client = new ChkszMusicClient({ apiKey: '' })
    await assert.rejects(() => client.getPlayUrl('chksz:163:1'), ChkszApiKeyMissingError)
    assert.equal(stub.urls.length, 0)
  } finally {
    stub.restore()
  }
})

test('非法 id 直接报错', async () => {
  const client = new ChkszMusicClient({ apiKey: 'k' })
  await assert.rejects(() => client.getPlayUrl('chksz:playlist:1'), /invalid chksz song id/)
})

test('verifyChkszKey：可用时 ok + 结果数', async () => {
  const stub = stubSequence([
    { code: 200, data: { songs: [{ id: 1, name: '歌', artists: 'a', duration: 100000 }] } },
  ])
  try {
    const check = await verifyChkszKey('k')
    assert.equal(check.ok, true)
    assert.match(check.message, /连接正常/)
  } finally {
    stub.restore()
  }
})

test('verifyChkszKey：空 key 不发请求，直接提示填写', async () => {
  const stub = stubSequence([{ code: 200, data: { songs: [] } }])
  try {
    const check = await verifyChkszKey('   ')
    assert.equal(check.ok, false)
    assert.match(check.message, /请先填写/)
    assert.equal(stub.urls.length, 0)
  } finally {
    stub.restore()
  }
})

test('verifyChkszKey：鉴权失败时把上游 msg 透出给设置页', async () => {
  const stub = stubSequence([{ code: 401, msg: '密钥已过期' }])
  try {
    const check = await verifyChkszKey('k')
    assert.equal(check.ok, false)
    assert.equal(check.message, '密钥已过期')
  } finally {
    stub.restore()
  }
})

test('createChkszResolver 与 verifyChkszKey 共用同一套 key 解析（早退仍是 null）', () => {
  const resolve = createChkszResolver(() => '')
  assert.equal(resolve(), null)
})
