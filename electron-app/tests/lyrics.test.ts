// 歌词解析（LRC）—— 歌词抽屉的行级高亮/滚动/点击跳转都依赖它。

import assert from 'node:assert/strict'
import test from 'node:test'
import { activeLyricIndex, parseLyrics, plainLyricLines } from '../src/state/lyrics'

test('解析基础时间戳，时间为秒', () => {
  const lines = parseLyrics('[00:01.00]第一行\n[00:05.50]第二行')
  assert.deepEqual(lines, [
    { time: 1, text: '第一行' },
    { time: 5.5, text: '第二行' },
  ])
})

test('一行多时间戳展开成多行', () => {
  const lines = parseLyrics('[00:01.00][00:05.00]副歌')
  assert.deepEqual(
    lines.map((l) => l.time),
    [1, 5],
  )
  assert.ok(lines.every((l) => l.text === '副歌'))
})

test('小数位按厘秒补齐（[00:01.5] = 1.5s）', () => {
  assert.equal(parseLyrics('[00:01.5]x')[0].time, 1.5)
  assert.equal(parseLyrics('[00:01.55]x')[0].time, 1.55)
})

test('元信息标签被忽略', () => {
  const lines = parseLyrics('[ti:歌名]\n[by:某人]\n[offset:0]\n[00:03.00]正文')
  assert.equal(lines.length, 1)
  assert.equal(lines[0].text, '正文')
})

test('翻译行并入上一行（无时间戳的紧跟行）', () => {
  const lines = parseLyrics('[00:03.00]原文\n译文\n[00:07.00]原文2')
  assert.equal(lines.length, 2)
  assert.match(lines[0].text, /原文/)
  assert.match(lines[0].text, /译文/)
})

test('无时间戳的纯文本歌词返回空数组，由 plainLyricLines 兜底', () => {
  const raw = '第一句歌词\n\n第二句歌词'
  assert.deepEqual(parseLyrics(raw), [])
  assert.deepEqual(plainLyricLines(raw), ['第一句歌词', '第二句歌词'])
})

test('activeLyricIndex 取最后一个已开始的行，并容忍 0.1s 提前量', () => {
  const lines = parseLyrics('[00:01.00]a\n[00:05.00]b\n[00:09.00]c')
  assert.equal(activeLyricIndex(lines, 0), -1, '第一行之前没有活动行')
  assert.equal(activeLyricIndex(lines, 0.95), 0, '0.1s 容差内提前高亮')
  assert.equal(activeLyricIndex(lines, 6), 1)
  assert.equal(activeLyricIndex(lines, 100), 2)
  assert.equal(activeLyricIndex([], 3), -1)
})

test('实际歌词样本：B 站字幕（netease 源）能解析出多行', () => {
  const raw =
    '[00:00.000] 作词 : 高橋優\n[00:01.000] 作曲 : 高橋優\n[00:02.000] 走进床头藏起的画\n'
  const lines = parseLyrics(raw)
  assert.equal(lines.length, 3)
  assert.match(lines[1].text, /高橋優/)
})
