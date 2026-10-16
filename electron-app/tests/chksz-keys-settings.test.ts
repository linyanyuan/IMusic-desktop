// ChKSz Key 池的设置层行为锚点：存储/迁移/订阅。
//
// 重点是迁移：旧版单 key（settings_chksz_api_key，Dart 端同名）首次读取时进入池，
// 随后旧 key 被删除 —— 否则用户把它删了之后又会「自己回来」。

import assert from 'node:assert/strict'
import test from 'node:test'
import { APP_SETTINGS_KEYS, AppSettings, migrateLegacyChkszKey } from '../src/services/appSettings'
import { MemoryStorage } from '../src/services/storage'

/** 旧版单 key 的存储名；写死以免改动 APP_SETTINGS_KEYS 时迁移断言失效 */
const LEGACY_STORAGE_KEY = 'settings_chksz_api_key'

function storedList(storage: MemoryStorage, key: string): string[] {
  const raw = storage.getString(key)
  return raw == null ? [] : (JSON.parse(raw) as string[])
}

test('默认 Key 池为空（构建期兜底 key 不混进池）', () => {
  const settings = new AppSettings(new MemoryStorage())
  assert.deepEqual(settings.getChkszApiKeys(), [])
  assert.deepEqual(settings.getSnapshot().chkszApiKeys, [])
})

test('setChkszApiKeys 去重、去空白，并写入新 key 的 JSON 数组', () => {
  const storage = new MemoryStorage()
  const settings = new AppSettings(storage)
  settings.setChkszApiKeys([' k1 ', 'k2', 'k1', '', '   '])

  assert.deepEqual(settings.getChkszApiKeys(), ['k1', 'k2'])
  assert.deepEqual(settings.getSnapshot().chkszApiKeys, ['k1', 'k2'])
  assert.deepEqual(storedList(storage, APP_SETTINGS_KEYS.chkszApiKeys), ['k1', 'k2'])
})

test('getChkszApiKeys 返回副本（调用方改动不污染内部状态）', () => {
  const settings = new AppSettings(new MemoryStorage())
  settings.setChkszApiKeys(['k1'])
  const list = settings.getChkszApiKeys()
  list.push('k2')
  assert.deepEqual(settings.getChkszApiKeys(), ['k1'])
})

test('首次读取把旧版单 key 迁移进池，并删除旧 key', () => {
  const storage = new MemoryStorage()
  storage.setString(LEGACY_STORAGE_KEY, 'legacy-key')

  const settings = new AppSettings(storage)
  assert.deepEqual(settings.getChkszApiKeys(), ['legacy-key'])
  assert.deepEqual(storedList(storage, APP_SETTINGS_KEYS.chkszApiKeys), ['legacy-key'])
  assert.equal(storage.getString(LEGACY_STORAGE_KEY), null, '旧 key 必须删除，避免删了又回来')
})

test('新 key 已存在时忽略旧 key（不做二次迁移）', () => {
  const storage = new MemoryStorage()
  storage.setStringList(APP_SETTINGS_KEYS.chkszApiKeys, ['pooled'])
  storage.setString(LEGACY_STORAGE_KEY, 'legacy-key')

  const settings = new AppSettings(storage)
  assert.deepEqual(settings.getChkszApiKeys(), ['pooled'])
  assert.equal(storage.getString(LEGACY_STORAGE_KEY), 'legacy-key', '不碰旧 key')
})

test('旧 key 为空串时迁移不产生空条目', () => {
  const storage = new MemoryStorage()
  storage.setString(LEGACY_STORAGE_KEY, '   ')
  const settings = new AppSettings(storage)
  assert.deepEqual(settings.getChkszApiKeys(), [])
  assert.equal(storage.getString(APP_SETTINGS_KEYS.chkszApiKeys), null, '没有 key 就不写新 key')
})

test('旧值等于构建期内置 key 时不迁入池（但旧存储项仍删除）', () => {
  // 旧版设置页的输入框预填的就是构建期 key，用户点保存会把它写进旧存储；
  // 内置 key 不应进池（与 client 的兜底语义一致）。测试环境读不到 import.meta.env，
  // 所以向迁移函数注入假 builtIn 来覆盖这条分支。
  const storage = new MemoryStorage()
  storage.setString(LEGACY_STORAGE_KEY, 'built-in-key')

  const migrated = migrateLegacyChkszKey(storage, 'built-in-key')
  assert.deepEqual(migrated, [])
  assert.equal(storage.getString(APP_SETTINGS_KEYS.chkszApiKeys), null, '内置 key 不写进池')
  assert.equal(
    storage.getString(LEGACY_STORAGE_KEY),
    null,
    '旧 key 仍要删除，避免每次启动重复判断',
  )

  // 走真实加载路径：旧值已删除、新 key 未写入 → 池保持为空
  const settings = new AppSettings(storage)
  assert.deepEqual(settings.getChkszApiKeys(), [])
})

test('旧值是普通用户 key 时正常迁入池（即使存在构建期内置 key）', () => {
  const storage = new MemoryStorage()
  storage.setString(LEGACY_STORAGE_KEY, 'user-key')

  const migrated = migrateLegacyChkszKey(storage, 'built-in-key')
  assert.deepEqual(migrated, ['user-key'])
  assert.deepEqual(storedList(storage, APP_SETTINGS_KEYS.chkszApiKeys), ['user-key'])
  assert.equal(storage.getString(LEGACY_STORAGE_KEY), null)

  const settings = new AppSettings(storage)
  assert.deepEqual(settings.getChkszApiKeys(), ['user-key'])
})

test('订阅者收到 Key 池变更（设置页增删即时生效），退订后不再收到', () => {
  const settings = new AppSettings(new MemoryStorage())
  const seen: string[][] = []
  const unsubscribe = settings.subscribe((snapshot) => {
    seen.push([...snapshot.chkszApiKeys])
  })

  settings.setChkszApiKeys(['k1'])
  unsubscribe()
  settings.setChkszApiKeys(['k1', 'k2'])

  assert.deepEqual(seen, [['k1']])
})
