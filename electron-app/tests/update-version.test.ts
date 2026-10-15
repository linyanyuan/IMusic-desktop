// 更新检查的版本比较 —— 移植自 Dart 端使用的 pub_semver 语义。
//
// 关键点：pub_semver 的 build metadata（`+22`）**参与**比较（与 node-semver 不同），
// 而 Dart 端 desktop-update.json 用的正是 `2.0.0+22` 这种版本号，
// 所以这里必须按 build 号来决定「是否更新」。

import assert from 'node:assert/strict'
import test from 'node:test'
import { compareVersions, isUpdateAvailable, parseVersion } from '../electron/update'

test('主版本号比较', () => {
  assert.equal(isUpdateAvailable('2.0.0', '2.0.1'), true)
  assert.equal(isUpdateAvailable('2.0.1', '2.0.0'), false)
  assert.equal(isUpdateAvailable('2.0.0', '2.0.0'), false)
  assert.equal(isUpdateAvailable('2.0.0', '1.9.9'), false)
  assert.equal(isUpdateAvailable('1.9.9', '2.0.0'), true)
})

test('build metadata 参与比较（pub_semver 语义）', () => {
  assert.equal(isUpdateAvailable('2.0.0+22', '2.0.0+23'), true)
  assert.equal(isUpdateAvailable('2.0.0+23', '2.0.0+22'), false)
  assert.equal(isUpdateAvailable('2.0.0+22', '2.0.0+22'), false)
  // 真实场景：本机 2.0.0，远端 9.9.9+7
  assert.equal(isUpdateAvailable('2.0.0', '9.9.9+7'), true)
})

test('预发布版本低于同号正式版', () => {
  assert.equal(isUpdateAvailable('2.0.0', '2.0.0-beta'), false)
  assert.equal(isUpdateAvailable('2.0.0-beta', '2.0.0'), true)
  assert.equal(isUpdateAvailable('2.0.0-1', '2.0.0-2'), true)
  assert.equal(isUpdateAvailable('2.0.0-alpha', '2.0.0-beta'), true)
})

test('无法解析的版本一律视为「无更新」', () => {
  assert.equal(parseVersion('not-a-version'), null)
  assert.equal(parseVersion('2.0'), null)
  assert.equal(parseVersion(''), null)
  assert.equal(isUpdateAvailable('garbage', '2.0.0'), false)
  assert.equal(isUpdateAvailable('2.0.0', 'garbage'), false)
})

test('parseVersion 解析出各段（含 build / preRelease）', () => {
  const parsed = parseVersion('2.0.0+22')
  assert.ok(parsed != null)
  assert.deepEqual([parsed.major, parsed.minor, parsed.patch], [2, 0, 0])
  assert.deepEqual(parsed.build, [22])
  assert.deepEqual(parseVersion('2.0.0-beta.3')?.preRelease, ['beta', 3])
})

test('compareVersions 大小关系与 isUpdateAvailable 一致', () => {
  const newer = parseVersion('2.0.1')
  const older = parseVersion('2.0.0')
  assert.ok(newer != null && older != null)
  assert.ok(compareVersions(newer, older) > 0)
  assert.ok(compareVersions(older, newer) < 0)
  assert.equal(compareVersions(older, parseVersion('2.0.0')!), 0)
})
