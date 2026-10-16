// 主题模式（浅色 / 深色 / 跟随系统）—— 服务层行为锚点。
//
// 主题是 DOM 副作用（切 html.dark 类），不依赖 React 重渲染，所以这里用假 DOM
// 直接验证：读取默认值、非法值收窄、切换后写存储、html.dark 是否生效、
// 以及 system 模式下系统主题变化能否自动跟随、离开 system 后监听器是否释放。

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  APP_SETTINGS_KEYS,
  AppSettings,
  normalizeThemeMode,
  resolveThemeIsDark,
} from '../src/services/appSettings'
import { MemoryStorage } from '../src/services/storage'

interface FakeMediaQueryList {
  matches: boolean
  media: string
  addEventListener: (type: string, cb: () => void) => void
  removeEventListener: (type: string, cb: () => void) => void
}

interface FakeDom {
  hasDark(): boolean
  listenerCount(): number
  setPrefersDark(value: boolean): void
}

/** 装一份最小假 DOM：html.classList.toggle + window.matchMedia */
function installFakeDom(prefersDark: boolean): FakeDom {
  const classes = new Set<string>()
  const listeners = new Set<() => void>()
  const mql: FakeMediaQueryList = {
    matches: prefersDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type, cb) => void listeners.add(cb),
    removeEventListener: (_type, cb) => void listeners.delete(cb),
  }
  const globals = globalThis as unknown as Record<string, unknown>
  globals.window = { matchMedia: () => mql }
  globals.document = {
    documentElement: {
      classList: {
        toggle(name: string, force?: boolean) {
          if (force === true) classes.add(name)
          else if (force === false) classes.delete(name)
          else if (classes.has(name)) classes.delete(name)
          else classes.add(name)
        },
      },
    },
  }
  return {
    hasDark: () => classes.has('dark'),
    listenerCount: () => listeners.size,
    setPrefersDark: (value) => {
      mql.matches = value
      for (const cb of listeners) cb()
    },
  }
}

test('normalizeThemeMode：三值原样保留，其余（含 null/数字）收窄为 system', () => {
  assert.equal(normalizeThemeMode('light'), 'light')
  assert.equal(normalizeThemeMode('dark'), 'dark')
  assert.equal(normalizeThemeMode('system'), 'system')
  for (const bad of ['blue', '', null, undefined, 7, {}, []]) {
    assert.equal(normalizeThemeMode(bad), 'system', `${String(bad)} 应回落到 system`)
  }
})

test('resolveThemeIsDark：手动值固定，system 跟随系统偏好', () => {
  assert.equal(resolveThemeIsDark('dark', false), true)
  assert.equal(resolveThemeIsDark('light', true), false)
  assert.equal(resolveThemeIsDark('system', true), true)
  assert.equal(resolveThemeIsDark('system', false), false)
})

test('默认 system；未设置存储时按系统偏好决定 html.dark', () => {
  const dom = installFakeDom(true)
  const settings = new AppSettings(new MemoryStorage())
  assert.equal(settings.themeMode, 'system')
  assert.equal(dom.hasDark(), true, 'system + 系统暗色 → html.dark')
})

test('setThemeMode 立即生效并写进 localStorage', () => {
  const dom = installFakeDom(true)
  const storage = new MemoryStorage()
  const settings = new AppSettings(storage)

  settings.setThemeMode('light')
  assert.equal(settings.themeMode, 'light')
  assert.equal(storage.getString(APP_SETTINGS_KEYS.themeMode), 'light')
  assert.equal(dom.hasDark(), false)
  assert.equal(dom.listenerCount(), 0, '离开 system 后必须释放 matchMedia 监听')

  settings.setThemeMode('dark')
  assert.equal(storage.getString(APP_SETTINGS_KEYS.themeMode), 'dark')
  assert.equal(dom.hasDark(), true)
})

test('重启保持：存储里的 dark 在构造时即应用', () => {
  const storage = new MemoryStorage()
  storage.setString(APP_SETTINGS_KEYS.themeMode, 'dark')
  const dom = installFakeDom(false)
  const settings = new AppSettings(storage)

  assert.equal(settings.themeMode, 'dark')
  assert.equal(dom.hasDark(), true)
})

test('重启保持：非法存储值收窄为 system 并跟随系统', () => {
  const storage = new MemoryStorage()
  storage.setString(APP_SETTINGS_KEYS.themeMode, 'midnight')
  const dom = installFakeDom(false)
  const settings = new AppSettings(storage)

  assert.equal(settings.themeMode, 'system')
  assert.equal(dom.hasDark(), false)
})

test('system 模式跟随系统主题变化；切到手动后不再被系统抢走', () => {
  const dom = installFakeDom(false)
  const settings = new AppSettings(new MemoryStorage())

  assert.equal(dom.hasDark(), false)
  dom.setPrefersDark(true)
  assert.equal(dom.hasDark(), true, '系统转暗 → 自动跟随')
  dom.setPrefersDark(false)
  assert.equal(dom.hasDark(), false)

  settings.setThemeMode('dark')
  assert.equal(dom.hasDark(), true)
  dom.setPrefersDark(false)
  assert.equal(dom.hasDark(), true, '手动 dark 不应被系统切走')
  assert.equal(dom.listenerCount(), 0, '监听器已释放')
})

test('反复 setThemeMode 不会叠加 matchMedia 监听器', () => {
  const dom = installFakeDom(false)
  const settings = new AppSettings(new MemoryStorage())
  for (let i = 0; i < 5; i++) settings.setThemeMode('system')
  assert.equal(dom.listenerCount(), 1)
})
