// 音乐口味偏好存储 —— 读写 / 上限 / 容错 / 清除 / 订阅 回归锚点。
//
// 与其它设置一致：每次调用实时读取（不做启动快照），所以这里用两个共享同一
// MemoryStorage 的 store 来验证「一个写、另一个立刻读到」。

import assert from 'node:assert/strict'
import test from 'node:test'
import { MemoryStorage } from '../src/services/storage'
import {
  DEFAULT_TASTE_PREFERENCES,
  TASTE_PREFERENCES_KEY,
  TastePreferencesStore,
  hasTastePreferences,
  shouldOfferTasteOnboarding,
} from '../src/services/tastePreferences'
import { MAX_TASTE_GENRES } from '../src/state/genres'

function makeStore() {
  const storage = new MemoryStorage()
  return { storage, store: new TastePreferencesStore(storage) }
}

test('默认值：未设置时为空偏好、未跳过，且需要展示引导', () => {
  const { store } = makeStore()
  const prefs = store.get()
  assert.deepEqual(prefs, DEFAULT_TASTE_PREFERENCES)
  assert.equal(hasTastePreferences(prefs), false)
  assert.equal(shouldOfferTasteOnboarding(prefs), true)
})

test('读写：set 后 get 能读回，并写入约定 key', () => {
  const { storage, store } = makeStore()
  store.set({ genres: ['pop', 'rock'] })
  assert.deepEqual(store.get().genres, ['pop', 'rock'])
  assert.equal(store.get().skipped, false)
  assert.ok(store.get().updatedAt !== '')
  assert.ok(storage.getString(TASTE_PREFERENCES_KEY)?.includes('"pop"'))
  assert.equal(hasTastePreferences(store.get()), true)
  assert.equal(shouldOfferTasteOnboarding(store.get()), false, '设置过就不再自动引导')
})

test('实时读取：另一个 store 共享同一存储时立刻可见', () => {
  const { storage, store } = makeStore()
  const other = new TastePreferencesStore(storage)
  assert.deepEqual(other.get().genres, [])
  store.set({ genres: ['jazz'] })
  assert.deepEqual(other.get().genres, ['jazz'], '必须每次实时读存储，不能启动时快照')
})

test('上限：最多保留 5 个分类', () => {
  const { store } = makeStore()
  store.set({
    genres: ['pop', 'rock', 'electronic', 'classical', 'folk', 'jazz', 'rap'],
  })
  assert.equal(store.get().genres.length, MAX_TASTE_GENRES)
  assert.deepEqual(store.get().genres, ['pop', 'rock', 'electronic', 'classical', 'folk'])
})

test('去重与未知 key：去重、丢弃不存在的 genre key', () => {
  const { store } = makeStore()
  store.set({ genres: ['pop', 'pop', 'not-a-genre', 'rock', ''] })
  assert.deepEqual(store.get().genres, ['pop', 'rock'])
})

test('损坏 JSON 容错：回退默认值而不是抛错', () => {
  const { storage, store } = makeStore()
  storage.setString(TASTE_PREFERENCES_KEY, '{ genres: [pop')
  assert.deepEqual(store.get(), DEFAULT_TASTE_PREFERENCES)

  storage.setString(TASTE_PREFERENCES_KEY, '"just a string"')
  assert.deepEqual(store.get(), DEFAULT_TASTE_PREFERENCES)

  storage.setString(TASTE_PREFERENCES_KEY, JSON.stringify({ genres: 'pop', skipped: 'yes' }))
  const prefs = store.get()
  assert.deepEqual(prefs.genres, [])
  assert.equal(prefs.skipped, false, 'skipped 非 true 一律按 false')
})

test('skip：不计偏好但不再自动引导', () => {
  const { store } = makeStore()
  store.skip()
  assert.deepEqual(store.get().genres, [])
  assert.equal(store.get().skipped, true)
  assert.equal(shouldOfferTasteOnboarding(store.get()), false)
  assert.equal(hasTastePreferences(store.get()), false)
})

test('clear：回到默认推荐，且引导可以再次出现', () => {
  const { storage, store } = makeStore()
  store.set({ genres: ['pop'] })
  store.clear()
  assert.deepEqual(store.get(), DEFAULT_TASTE_PREFERENCES)
  assert.equal(storage.getString(TASTE_PREFERENCES_KEY), null)
  assert.equal(shouldOfferTasteOnboarding(store.get()), true, '清除后引导应能再次出现')
})

test('订阅：set/clear 都会通知监听者', () => {
  const { store } = makeStore()
  const seen: string[][] = []
  const unsubscribe = store.subscribe((prefs) => seen.push(prefs.genres))
  store.set({ genres: ['pop'] })
  store.clear()
  unsubscribe()
  store.set({ genres: ['rock'] })
  assert.deepEqual(seen, [['pop'], []])
})
