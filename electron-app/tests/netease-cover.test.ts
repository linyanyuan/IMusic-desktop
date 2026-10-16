// 网易云封面清晰度 —— 回归锚点：分类页/歌单详情封面模糊（卡片渲染 227px，图只有 140×140）。
//
// 接口返回的 coverImgUrl 带一长串 imageView/watermark 参数，**最后一处 thumbnail=140y140
// （水印图参数）会覆盖前面的 800y800**，实测拿到的就是 140×140；丢掉整串 query 改写成
// ?param=<size>y<size> 实测有效（?param=500y500 → 500×500）。
// 这里只测 normalizeNeteaseCover 的纯逻辑；请求侧断言在 tests/netease.test.ts。

import assert from 'node:assert/strict'
import test from 'node:test'
import { NETEASE_COVER_SIZE, normalizeNeteaseCover } from '../src/services/netease'

/**
 * 真实样例（来自 /api/playlist/list 的 coverImgUrl）：
 * 一串 imageView/watermark 参数，末尾 thumbnail=140y140 覆盖前面的 800y800。
 */
const WATERMARK_QUERY =
  'imageView=1&thumbnail=800y800&enlarge=1%7CimageView=1&watermark&type=1&image=AAAA&dx=0&dy=0' +
  '%7Cwatermark&type=1&image=BBBB&dx=0&dy=0%7CimageView=1&thumbnail=140y140&'

/** 调用点顺序是 httpToHttps(...) → normalizeNeteaseCover(...)，所以这里用 https 形态 */
const REAL_SAMPLE = `https://p1.music.126.net/xxx.jpg?${WATERMARK_QUERY}`

test('丢掉整串水印 query，改写成 ?param=500y500', () => {
  assert.equal(normalizeNeteaseCover(REAL_SAMPLE), 'https://p1.music.126.net/xxx.jpg?param=500y500')
})

test('真实 http:// 原样保留协议（http→https 由 httpToHttps 负责，不是本函数的职责）', () => {
  const http = `http://p1.music.126.net/xxx.jpg?${WATERMARK_QUERY}`
  assert.equal(normalizeNeteaseCover(http), 'http://p1.music.126.net/xxx.jpg?param=500y500')
})

test('默认尺寸就是 NETEASE_COVER_SIZE', () => {
  assert.equal(NETEASE_COVER_SIZE, 500)
  assert.equal(
    normalizeNeteaseCover('https://p1.music.126.net/a.jpg'),
    `https://p1.music.126.net/a.jpg?param=${NETEASE_COVER_SIZE}y${NETEASE_COVER_SIZE}`,
  )
})

test('自定义 size：300 → ?param=300y300', () => {
  assert.equal(normalizeNeteaseCover(REAL_SAMPLE, 300), 'https://p1.music.126.net/xxx.jpg?param=300y300')
})

test('干净的 URL（无 query）也要补上尺寸参数', () => {
  assert.equal(normalizeNeteaseCover('https://p1.music.126.net/a.jpg'), 'https://p1.music.126.net/a.jpg?param=500y500')
})

test('非网易云 host 原样返回（含原 query），不强加 param', () => {
  const bilibili = 'https://i0.hdslb.com/a.jpg?x=1'
  assert.equal(normalizeNeteaseCover(bilibili), bilibili)
  const other = 'https://cdn.example.com/cover.jpg?thumbnail=140y140'
  assert.equal(normalizeNeteaseCover(other), other)
})

test('host 匹配必须精确：只有 music.126.net 及其子域才算网易云', () => {
  // 子域（p1./p2./m801. …）应被处理
  assert.equal(normalizeNeteaseCover('https://m801.music.126.net/a.jpg'), 'https://m801.music.126.net/a.jpg?param=500y500')
  assert.equal(normalizeNeteaseCover('https://music.126.net/a.jpg'), 'https://music.126.net/a.jpg?param=500y500')

  // 伪装/相似域名必须原样返回
  const evil = 'https://evilmusic.126.net.evil.com/a.jpg'
  assert.equal(normalizeNeteaseCover(evil), evil, '后缀伪装域名不能被当成网易云')
  const plain = 'https://music126net/a.jpg'
  assert.equal(normalizeNeteaseCover(plain), plain, '缺少点号的相似 host 不能被当成网易云')
  const prefix = 'https://xmusic.126.net/a.jpg'
  assert.equal(normalizeNeteaseCover(prefix), prefix, '前缀粘连域名不能被当成网易云')
})

test('空串 / 纯空白 → 空串', () => {
  assert.equal(normalizeNeteaseCover(''), '')
  assert.equal(normalizeNeteaseCover('   '), '')
  assert.equal(normalizeNeteaseCover('\n\t '), '')
})

test('size 非法（0 / 负数 / NaN）回退到 NETEASE_COVER_SIZE', () => {
  const expected = 'https://p1.music.126.net/a.jpg?param=500y500'
  assert.equal(normalizeNeteaseCover('https://p1.music.126.net/a.jpg', 0), expected)
  assert.equal(normalizeNeteaseCover('https://p1.music.126.net/a.jpg', -10), expected)
  assert.equal(normalizeNeteaseCover('https://p1.music.126.net/a.jpg', Number.NaN), expected)
  assert.equal(normalizeNeteaseCover('https://p1.music.126.net/a.jpg', Number.POSITIVE_INFINITY), expected)
})

test('非法 URL 字符串原样返回、不抛异常', () => {
  assert.equal(normalizeNeteaseCover('not a url'), 'not a url')
  assert.equal(normalizeNeteaseCover('  not a url  '), 'not a url')
  assert.equal(normalizeNeteaseCover('p1.music.126.net/a.jpg'), 'p1.music.126.net/a.jpg')
})

test('非 http(s) 协议原样返回（不误改 data:/blob: 等）', () => {
  assert.equal(normalizeNeteaseCover('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
})

test('两端空白被 trim 后再判断 host', () => {
  assert.equal(
    normalizeNeteaseCover('  https://p1.music.126.net/a.jpg  '),
    'https://p1.music.126.net/a.jpg?param=500y500',
  )
})
