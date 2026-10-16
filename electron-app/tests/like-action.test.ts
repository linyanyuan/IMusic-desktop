// 收藏守卫（src/state/likeAction.ts）—— 对应 Dart 端各 _toggleFavorite 的登录门。
//
// 回归点：未登录时点 ♥ 曾直接发 PUT /library（空 Bearer → 401 → 回滚），
// 心形闪一下又变回去且没有任何提示。这里断言：
//   - 未登录：库方法一次都不调，并弹出「请先登录」
//   - 已登录：调用一次，且不产生新提示
//   - 失败：产生「收藏失败，请稍后重试」提示（原来失败是静默的未处理 rejection）
//
// 用最小假对象（只需 isLoggedIn 与 toggleLike）注入，避免构造真实服务。
// 「当前提示」通过一次真实渲染读 hook 快照：比较对象引用即可判断有没有新提示，
// 不必等 2 秒计时器到期。

import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { toggleLikeGuarded } from '../src/state/likeAction'
import { useNotice, type Notice } from '../src/state/notice'
import type { AuthService } from '../src/services/auth'
import type { LibraryService } from '../src/services/library'
import type { Song } from '../src/services/models'

const captured: Array<Notice | null> = []

function Probe() {
  const notice = useNotice()
  captured.push(notice)
  return createElement('span', null, notice?.message ?? '')
}

/** 当前提示（可能来自上一次 showNotice，用引用比较判断是否有新提示） */
function readNotice(): Notice | null {
  captured.length = 0
  renderToStaticMarkup(createElement(Probe))
  return captured[0] ?? null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const SONG: Song = {
  id: 'netease:123',
  title: '测试歌曲',
  artist: '测试歌手',
  source: 'Netease',
  duration: '03:00',
  resultType: 'song',
  songCount: 0,
  isFavorite: false,
  isCached: false,
  extra: {},
}

function fakeAuth(isLoggedIn: boolean): AuthService {
  return { isLoggedIn } as unknown as AuthService
}

/** 记录调用的假音乐库；behaviour 决定 toggleLike 返回 resolve 还是 reject */
function fakeLibrary(): { library: LibraryService; calls: Song[] } {
  const calls: Song[] = []
  const library = {
    toggleLike(song: Song): Promise<void> {
      calls.push(song)
      return Promise.resolve()
    },
  } as unknown as LibraryService
  return { library, calls }
}

test('未登录：不发请求，提示「请先登录」', () => {
  const { library, calls } = fakeLibrary()

  toggleLikeGuarded(fakeAuth(false), library, SONG)

  assert.equal(calls.length, 0, '未登录时绝不能调用 library.toggleLike')
  assert.equal(readNotice()?.message, '请先登录')
})

test('已登录：调用一次 toggleLike，且不产生新提示', async () => {
  const before = readNotice()
  const { library, calls } = fakeLibrary()

  toggleLikeGuarded(fakeAuth(true), library, SONG)
  await sleep(0)

  assert.deepEqual(calls, [SONG], '已登录时应恰好调用一次')
  assert.equal(readNotice(), before, '成功路径不应弹提示')
})

test('toggleLike 失败：提示「收藏失败，请稍后重试」', async () => {
  const before = readNotice()
  const library = {
    toggleLike(): Promise<void> {
      return Promise.reject(new Error('401 Unauthorized'))
    },
  } as unknown as LibraryService

  // 守卫内部必须 catch 掉 rejection，否则这里会变成未处理 rejection
  toggleLikeGuarded(fakeAuth(true), library, SONG)
  await sleep(0)

  const after = readNotice()
  assert.notEqual(after, before, '失败必须产生新提示')
  assert.equal(after?.message, '收藏失败，请稍后重试')

  // 收尾：等默认 2s 计时器到期，别把它的定时器留到测试进程退出
  await sleep(2100)
  assert.equal(readNotice(), null)
})
