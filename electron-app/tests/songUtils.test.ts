// songUtils.durationSeconds 的单位回归。
//
// 背景：B 站 provider 统一把时长存成毫秒（duration * 1000，与 Dart 端一致），
// 但 TS 移植时加了 `> 100000 ? /1000 : raw` 的启发式 —— 于是 95 000ms（95 秒）
// 这类小于 100 秒的片段被当成「秒」，显示成 26000+ 分钟。
// Dart 的 _songDurationSeconds 是无条件 `raw ~/ 1000`，这里锁定同语义。

import assert from 'node:assert/strict'
import test from 'node:test'
import { durationSeconds } from '../src/state/songUtils'
import type { Song } from '../src/services/models'

function song(patch: Partial<Song> & { extra?: Record<string, unknown> }): Song {
  return {
    id: 'x',
    title: 't',
    artist: 'a',
    source: 's',
    duration: '0:00',
    resultType: 'song',
    songCount: 1,
    isFavorite: false,
    isCached: false,
    extra: {},
    ...patch,
  } as Song
}

test('数值型 duration 一律按毫秒换算（含 <100s 的短片）', () => {
  assert.equal(durationSeconds(song({ extra: { duration: 95000 } })), 95)
  assert.equal(durationSeconds(song({ extra: { duration: 294000 } })), 294)
  assert.equal(durationSeconds(song({ extra: { duration: 30000 } })), 30)
})

test('纯数字字符串 duration 同样按毫秒', () => {
  assert.equal(durationSeconds(song({ extra: { duration: '95000' } })), 95)
})

test('"m:ss" 展示字符串按分秒解析', () => {
  assert.equal(durationSeconds(song({ duration: '4:54' })), 294)
  assert.equal(durationSeconds(song({ extra: { duration: '4:54' } })), 294)
})

test('缺失/非法 duration 回落到 0', () => {
  assert.equal(durationSeconds(song({ duration: '0:00' })), 0)
  assert.equal(durationSeconds(song({ extra: { duration: 'abc' } })), 0)
})
