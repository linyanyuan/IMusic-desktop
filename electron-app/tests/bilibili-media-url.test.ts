// B 站媒体地址挑选 —— 回归锚点：合集里的歌一点就「播放失败（已重试 2 次）」。
//
// playurl 对每个音频流给出 3 个候选（真实样本，见 qa 取证）：
//   1. https://xy122x189x48x6xy.mcdn.bilivideo.cn:8082/v1/resource/...   （PCDN）
//   2. https://b-baaa...edge.mountaintoys.cn:4483/upgcxcode/...         （PCDN 镜像，域名不固定）
//   3. https://upos-sz-mirrorbd.bilivideo.com/upgcxcode/...             （标准 CDN，可播）
//
// 旧逻辑只排除字面量 `mcdn.bilivideo`，于是第 2 个 PCDN 镜像被选中 —— 端口 4483
// 在代理/公司网下连不通，readyState 永远是 0，20s 后元数据超时并重试 2 次后报错。

import assert from 'node:assert/strict'
import test from 'node:test'
import { isPcdnMediaUrl, pickBestMediaUrl } from '../src/services/bilibili'

const PCDN_MCDN =
  'https://xy122x189x48x6xy.mcdn.bilivideo.cn:8082/v1/resource/upgcxcode/51/60/42118876051/42118876051-1-30280.m4s?os=mcdn&deadline=1792004270'
const PCDN_MIRROR =
  'https://b-baaa94a63gg3sch6cg12g5duby94c.edge.mountaintoys.cn:4483/upgcxcode/51/60/42118876051/42118876051-1-30280.m4s?os=mcdn&og=cos&mcdnid=50062501'
const UPOS =
  'https://upos-sz-mirrorbd.bilivideo.com/upgcxcode/51/60/42118876051/42118876051-1-30280.m4s?e=ig8eux&os=bdbv'
const UPOS_HW =
  'https://upos-sz-mirrorhwo1.bilivideo.com/upgcxcode/51/60/42118876051/42118876051-1-30280.m4s?os=hwo1bv'

test('识别 PCDN：mcdn 域名、已知镜像域名、4483/8082 端口、os=mcdn', () => {
  assert.equal(isPcdnMediaUrl(PCDN_MCDN), true)
  assert.equal(isPcdnMediaUrl(PCDN_MIRROR), true, '域名不含 mcdn.bilivideo，但仍是 PCDN')
  assert.equal(isPcdnMediaUrl(UPOS), false)
  assert.equal(isPcdnMediaUrl('https://upos-sz-mirrorcoso1.bilivideo.com/x.m4s?os=coso1bv'), false)
  // 端口判定兜底（域名未知时）
  assert.equal(isPcdnMediaUrl('https://unknown-cdn.example.com:4483/x.m4s'), true)
  assert.equal(isPcdnMediaUrl('not a url'), false, '非法 URL 不抛错')
})

test('候选顺序为 [PCDN, PCDN镜像, 标准CDN] 时，必须挑标准 CDN', () => {
  const picked = pickBestMediaUrl([PCDN_MCDN, PCDN_MIRROR, UPOS])
  assert.equal(picked, UPOS, '这正是合集播放失败的场景')
})

test('只有 PCDN 可用时仍然返回它（不空手）', () => {
  assert.equal(pickBestMediaUrl([PCDN_MCDN, PCDN_MIRROR]), PCDN_MCDN)
})

test('多个标准 CDN 时取第一个标准 CDN', () => {
  assert.equal(pickBestMediaUrl([PCDN_MIRROR, UPOS, UPOS_HW]), UPOS)
})

test('非 B 站域名的普通 https 地址可用（akamaized 等）', () => {
  const akamai = 'https://upos-sz-mirrorali.bilivideo.com/x.m4s'
  assert.equal(pickBestMediaUrl(['', '   ', akamai]), akamai)
})

test('空列表返回 null，空白项被忽略', () => {
  assert.equal(pickBestMediaUrl([]), null)
  assert.equal(pickBestMediaUrl(['', '  ']), null)
})

test('durl 备份地址数组同样按标准 CDN 优先挑选', () => {
  const picked = pickBestMediaUrl([`${PCDN_MIRROR}`, UPOS])
  assert.equal(picked, UPOS)
})
