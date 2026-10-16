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
import { ChkszKeyPool } from '../src/services/chkszKeyPool'

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

// === Key 池（多条 key 轮询 + 失效自动切换） ===

/** 按预设 [{status, body}] 顺序响应（可指定 HTTP 状态码）的假 fetch */
function stubResponses(
  steps: Array<{ status: number; body: unknown }>,
): { urls: string[]; restore: () => void } {
  const urls: string[] = []
  let index = 0
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input))
    const step = steps[Math.min(index, steps.length - 1)]
    index += 1
    return new Response(JSON.stringify(step ? step.body : {}), {
      status: step ? step.status : 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return {
    urls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

const OK_URL_BODY = {
  code: 200,
  data: { id: 1, url: 'http://m1.music.126.net/a.mp3' },
}

function poolOf(keys: string[]): ChkszKeyPool {
  const pool = new ChkszKeyPool()
  pool.setKeys(keys)
  return pool
}

test('Key 池：第一条 key 命中 401 时自动换第二条重试', async () => {
  const stub = stubResponses([
    { status: 401, body: { code: 401, msg: 'invalid apikey' } },
    { status: 200, body: OK_URL_BODY },
  ])
  try {
    const client = new ChkszMusicClient({ keyPool: poolOf(['bad', 'good']) })
    const playback = await client.getPlayUrl('chksz:163:1')
    assert.equal(playback.url, 'https://m1.music.126.net/a.mp3')
    assert.equal(stub.urls.length, 2)
    assert.ok(stub.urls[0].includes('apikey=bad'))
    assert.ok(stub.urls[1].includes('apikey=good'), '第二条 key 顶上')
  } finally {
    stub.restore()
  }
})

test('Key 池：全部 key 都失效时上抛最后一条的错误，每条只试一次', async () => {
  const stub = stubResponses([{ status: 401, body: { code: 401, msg: 'invalid apikey' } }])
  try {
    const client = new ChkszMusicClient({ keyPool: poolOf(['k1', 'k2']) })
    await assert.rejects(
      () => client.getPlayUrl('chksz:163:1'),
      (e: unknown) => e instanceof ChkszApiError && e.status === 401,
    )
    assert.equal(stub.urls.length, 2)
  } finally {
    stub.restore()
  }
})

test('Key 池：失效 key 进入冷却，后续请求直接走可用 key', async () => {
  const stub = stubResponses([
    { status: 401, body: { code: 401, msg: 'invalid apikey' } },
    { status: 200, body: OK_URL_BODY },
    { status: 200, body: OK_URL_BODY },
  ])
  try {
    const client = new ChkszMusicClient({ keyPool: poolOf(['bad', 'good']) })
    await client.getPlayUrl('chksz:163:1')
    await client.getPlayUrl('chksz:163:1')
    assert.equal(stub.urls.length, 3, '第二次请求不应再试 bad')
    assert.ok(stub.urls[2].includes('apikey=good'))
  } finally {
    stub.restore()
  }
})

test('Key 池为空时回落到原有单 key 路径（行为不变）', async () => {
  const stub = stubSequence([OK_URL_BODY])
  try {
    const client = new ChkszMusicClient({ keyPool: poolOf([]), apiKey: 'single' })
    await client.getPlayUrl('chksz:163:1')
    assert.ok(stub.urls[0].includes('apikey=single'))
  } finally {
    stub.restore()
  }
})

test('Key 池：与 key 无关的错误（业务 500）不触发换 key 重试', async () => {
  const stub = stubResponses([{ status: 200, body: { code: 500, msg: 'boom' } }])
  try {
    const client = new ChkszMusicClient({ keyPool: poolOf(['a', 'b']) })
    await assert.rejects(
      () => client.searchSongs('周杰伦', 1),
      (e: unknown) => e instanceof ChkszApiError && /boom/.test((e as Error).message),
    )
    assert.equal(stub.urls.length, 1, '不是 key 失效，不该消耗其他 key 重试')
    assert.ok(stub.urls[0].includes('apikey=a'))
  } finally {
    stub.restore()
  }
})

test('Key 池：业务体 code 401（HTTP 200）不是 key 失效信号，不换 key/不冷却', async () => {
  // 业务 code 与 HTTP status 是两套命名空间：上游可能因版权/权限等非 key 原因
  // 返回 code 401/403/429。若把它当成 key 失效，池会冷却健康 key 并轮换（对齐 Dart
  // 端：业务错误不带 status，只有 HTTP 层错误带）。
  const pool = poolOf(['a', 'b'])
  const stub = stubResponses([{ status: 200, body: { code: 401, msg: '版权限制' } }])
  try {
    const client = new ChkszMusicClient({ keyPool: pool })
    await assert.rejects(
      () => client.searchSongs('周杰伦', 1),
      (e: unknown) =>
        e instanceof ChkszApiError &&
        e.status === undefined &&
        /版权限制/.test((e as Error).message),
    )
    assert.equal(stub.urls.length, 1, '业务错误与 key 无关，不该消耗其他 key 重试')
    assert.ok(stub.urls[0].includes('apikey=a'))
    assert.equal(pool.acquire(), 'b')
    assert.equal(pool.acquire(), 'a', 'a 未被冷却，轮询一圈后仍可再用')
  } finally {
    stub.restore()
  }
})

test('Key 池：单音质无地址只是降一档信号，不把 key 打进冷却', async () => {
  const pool = poolOf(['a', 'b'])
  const stub = stubResponses([
    {
      status: 200,
      body: {
        code: 404,
        msg: 'Music URL not found, song may be unavailable at this quality level',
      },
    },
    { status: 200, body: OK_URL_BODY },
  ])
  try {
    const client = new ChkszMusicClient({ keyPool: pool })
    const playback = await client.getPlayUrl('chksz:163:1')
    assert.equal(playback.url, 'https://m1.music.126.net/a.mp3')
    assert.equal(stub.urls.length, 2)
    assert.ok(stub.urls[0].includes('apikey=a'))
    assert.ok(stub.urls[1].includes('apikey=b'), '降档请求按轮询用下一条 key')
    // 若 quality miss 被误判成 key 失效，a 进冷却 → acquire 会跳过它返回 b
    assert.equal(pool.acquire(), 'a', 'quality miss 不应把 key 打进冷却')
  } finally {
    stub.restore()
  }
})
