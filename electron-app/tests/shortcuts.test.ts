// 快捷键：作用域隔离 + 默认键位。
//
// 背景（项目记忆 #83）：globalAccelerators() 曾把**所有**动作（含 scope:'inApp'
// 的 Space / F）都送去主进程 globalShortcut 注册成系统级热键 —— 应用一运行就把
// 空格和 F 从整个系统抢走（其他程序打不出空格），且与渲染进程 keydown 重复触发。
// 修复后只有 scope:'global' 的动作进注册表，这里是它的回归断言。

import assert from 'node:assert/strict'
import test from 'node:test'
import { ShortcutSettings, globalAccelerators } from '../src/services/shortcutSettings'

test('默认设置里只有 7 条全局热键进注册表，应用内动作不进', () => {
  const accelerators = globalAccelerators(ShortcutSettings.defaults())
  assert.equal(Object.keys(accelerators).length, 7)
  assert.equal('playPauseInApp' in accelerators, false, '空格是应用内动作，绝不能全局注册')
  assert.equal('toggleFocusMode' in accelerators, false, 'F 是应用内动作，绝不能全局注册')
  for (const action of [
    'playPauseGlobal',
    'previousTrack',
    'nextTrack',
    'volumeUp',
    'volumeDown',
    'mute',
    'toggleDesktopLyrics',
  ]) {
    assert.ok(action in accelerators, `${action} 应注册为全局热键`)
  }
})

test('注册表里不存在无修饰单键（否则会抢占系统按键）', () => {
  const accelerators = globalAccelerators(ShortcutSettings.defaults())
  for (const [action, accelerator] of Object.entries(accelerators)) {
    const hasModifier = /(Ctrl|Alt|Shift|Super|Command|Cmd)/i.test(accelerator)
    assert.ok(hasModifier, `${action} 的 ${accelerator} 缺少修饰键`)
  }
})

test('默认全局热键与 Dart 端默认值一致（Ctrl+Alt+…，用 Electron accelerator 写法）', () => {
  const accelerators = globalAccelerators(ShortcutSettings.defaults())
  assert.equal(accelerators.playPauseGlobal, 'CommandOrControl+Alt+P')
  assert.equal(accelerators.previousTrack, 'CommandOrControl+Alt+Left')
  assert.equal(accelerators.nextTrack, 'CommandOrControl+Alt+Right')
  assert.equal(accelerators.volumeUp, 'CommandOrControl+Alt+Up')
  assert.equal(accelerators.volumeDown, 'CommandOrControl+Alt+Down')
  assert.equal(accelerators.mute, 'CommandOrControl+Alt+M')
  assert.equal(accelerators.toggleDesktopLyrics, 'CommandOrControl+Alt+D')
})

test('用户把应用内动作改成带修饰键的组合，仍然不会进全局注册表', () => {
  const settings = ShortcutSettings.fromJson({
    globalHotkeysEnabled: true,
    shortcuts: {
      playPauseInApp: { control: true, alt: true, shift: true, meta: false, key: 'p' },
      toggleFocusMode: { control: true, shift: true, meta: false, alt: false, key: 'f' },
    },
  })
  const accelerators = globalAccelerators(settings)
  assert.equal('playPauseInApp' in accelerators, false)
  assert.equal('toggleFocusMode' in accelerators, false)
  assert.equal(Object.keys(accelerators).length, 7)
})

test('fromJson 容忍损坏输入并回落到默认值', () => {
  for (const broken of [null, undefined, 42, 'nonsense', {}, { shortcuts: 'bad' }]) {
    const settings = ShortcutSettings.fromJson(broken)
    assert.equal(Object.keys(globalAccelerators(settings)).length, 7)
  }
})

test('清空某个全局热键后它不再进入注册表', () => {
  const settings = ShortcutSettings.fromJson({
    globalHotkeysEnabled: true,
    shortcuts: { mute: null },
  })
  const accelerators = globalAccelerators(settings)
  assert.equal('mute' in accelerators, false)
  assert.equal(Object.keys(accelerators).length, 6)
})

// 回归：用户把「全局」动作录成无修饰单键（如 F/Space）时，不得进 OS 级注册表，
// 否则运行期间会把该键从整个系统抢走（且与应用内 keydown 双重触发）。
test('全局动作被录成无修饰单键时不进注册表', () => {
  const settings = ShortcutSettings.fromJson({
    globalHotkeysEnabled: true,
    shortcuts: {
      playPauseGlobal: { control: false, alt: false, shift: false, meta: false, key: 'f' },
    },
  })
  const accelerators = globalAccelerators(settings)
  assert.equal('playPauseGlobal' in accelerators, false)
  assert.equal(Object.keys(accelerators).length, 6)
})
