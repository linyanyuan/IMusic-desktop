// 全局提示 store（src/state/notice.ts）—— 服务层行为锚点。
//
// 对应 Flutter 端 SnackBar：未登录点收藏时「请先登录」显示约 2 秒后自动消失。
// 提示是模块级的、不依赖 electron / DOM，所以直接测 store 本身；唯一需要 React 的
// 部分是 useNotice（useSyncExternalStore），这里用 react-dom/server 做一次真实渲染，
// 顺便验证「快照引用稳定」这条 useSyncExternalStore 的硬性要求。

import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { showNotice, useNotice, type Notice } from '../src/state/notice'

/** 每次渲染时 hook 的返回值 —— 用于比较快照引用 */
const captured: Array<Notice | null> = []

function Probe() {
  const notice = useNotice()
  captured.push(notice)
  return createElement('span', null, notice?.message ?? '')
}

/** 渲染一次 Probe，返回本次渲染拿到的提示对象（captured[0]） */
function readNotice(): Notice | null {
  captured.length = 0
  renderToStaticMarkup(createElement(Probe))
  return captured[0] ?? null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('无提示时为 null；showNotice 后可见，到期自动回到 null', async () => {
  assert.equal(readNotice(), null, '初始状态没有提示')

  showNotice('请先登录', 60)
  assert.equal(readNotice()?.message, '请先登录')

  await sleep(90)
  assert.equal(readNotice(), null, '计时器到期后提示应清空')
})

test('重复调用替换当前提示，并重置计时器（旧计时器不得清掉新提示）', async () => {
  showNotice('第一条', 120)
  assert.equal(readNotice()?.message, '第一条')

  await sleep(60)
  showNotice('第二条', 120) // 若不重置，第一条的计时器会在 t=120ms 处清空提示
  await sleep(80) // t=140ms：第一条计时器已到期，第二条还差 40ms
  assert.equal(readNotice()?.message, '第二条', '旧计时器提前清掉了新提示')

  await sleep(80) // t=220ms：第二条计时器（t=180ms）已到期
  assert.equal(readNotice(), null)
})

test('id 自增：每条新提示都是新对象（供 UI 重挂载动画）', async () => {
  showNotice('A', 40)
  const first = readNotice()
  showNotice('B', 40)
  const second = readNotice()

  assert.ok(first != null && second != null)
  assert.notEqual(first, second)
  assert.ok(second.id > first.id, 'id 必须递增')
  await sleep(60)
})

test('状态未变化时快照引用稳定（连续读取返回同一个对象）', async () => {
  showNotice('同一条', 40)
  const first = readNotice()
  const second = readNotice()
  const third = readNotice()

  assert.ok(first != null)
  assert.equal(first, second, '未变化时必须返回同一引用')
  assert.equal(second, third)
  await sleep(60)
})
