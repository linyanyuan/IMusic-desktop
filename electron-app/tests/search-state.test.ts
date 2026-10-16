// 搜索状态 store（src/state/searchState.ts）—— 跨卸载存活的锚点。
//
// 回归点：搜索状态原来放在 SearchView 组件内 useState，而路由切换会卸载重建
// SearchView（去歌单详情后按后退、进出专注模式），用户因此丢掉搜索结果、回到空搜索页。
// 对齐 Dart 端 lib/desktop/screens/desktop_search_screen.dart 的模块级 Riverpod provider。
//
// 这里直接测模块级 store（不依赖 electron / DOM）。要点：
//   - 过期响应必须丢弃（两次搜索的响应乱序回来时，只有最后一次能写状态）；
//   - resetSearch 保留 tab/scope，并让在途响应失效；
//   - 每次发布都是新对象引用（useSyncExternalStore 触发重渲染的前提）。

import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CHKSZ_KEY_MISSING,
  getSearchState,
  resetSearch,
  runSearch,
  setSearchTab,
  subscribeSearch,
  useSearchState,
  type SearchRunner,
  type SearchState,
} from '../src/state/searchState'
import { MusicSearchScope, type Song } from '../src/services/models'
import type { MusicSearchScope as Scope } from '../src/services/models'

function song(id: string, resultType = 'song'): Song {
  return {
    id,
    title: `title-${id}`,
    artist: 'artist',
    source: 'Bilibili',
    duration: '03:00',
    resultType,
    songCount: 0,
    isFavorite: false,
    isCached: false,
    extra: {},
  }
}

function ids(): string[] {
  return getSearchState().results.map((s) => s.id)
}

/** 用空关键词跑一次，把 scope 也复位（resetSearch 按语义保留 scope） */
function resetStore(): void {
  void runSearch(async () => [], '', MusicSearchScope.All, 1, false)
  setSearchTab('song')
  resetSearch()
}

beforeEach(resetStore)

test('成功搜索：关键词 trim、结果/页码/加载态正确，订阅者被通知', async () => {
  const calls: Array<{ query: string; page: number; scope: Scope }> = []
  const runner: SearchRunner = async (query, page, scope) => {
    calls.push({ query, page, scope })
    return [song('1'), song('2')]
  }

  let notifications = 0
  const unsubscribe = subscribeSearch(() => {
    notifications += 1
  })

  await runSearch(runner, '  周杰伦  ', MusicSearchScope.ChkszSongs, 1, false)
  unsubscribe()

  const state = getSearchState()
  assert.equal(state.query, '周杰伦', '关键词应已 trim')
  assert.equal(state.scope, MusicSearchScope.ChkszSongs)
  assert.equal(state.page, 1)
  assert.deepEqual(ids(), ['1', '2'])
  assert.equal(state.loading, false)
  assert.equal(state.loadingMore, false)
  assert.equal(state.error, null)

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { query: '周杰伦', page: 1, scope: MusicSearchScope.ChkszSongs })
  assert.ok(notifications > 0, '订阅者应被通知')
})

test('跨「卸载」保留：搜索完再读 getSearchState() 仍是完整结果，引用稳定', async () => {
  const runner: SearchRunner = async () => [song('1'), song('2'), song('3')]
  await runSearch(runner, '关键字', MusicSearchScope.All, 1, false)

  // 等价于 SearchView 卸载后重新挂载：状态在模块级，重新读取仍完整。
  const afterRemount = getSearchState()
  assert.equal(afterRemount.query, '关键字')
  assert.deepEqual(afterRemount.results.map((s) => s.id), ['1', '2', '3'])

  // 快照引用稳定（useSyncExternalStore 的硬性要求）
  assert.equal(getSearchState(), getSearchState())
  assert.equal(getSearchState(), afterRemount)
})

test('过期响应丢弃：先发的搜索后 resolve，不得覆盖新搜索的结果', async () => {
  let resolveA!: (songs: Song[]) => void
  let resolveB!: (songs: Song[]) => void
  const runnerA: SearchRunner = () =>
    new Promise<Song[]>((resolve) => {
      resolveA = resolve
    })
  const runnerB: SearchRunner = () =>
    new Promise<Song[]>((resolve) => {
      resolveB = resolve
    })

  const pendingA = runSearch(runnerA, 'A', MusicSearchScope.All, 1, false) // 挂起
  const pendingB = runSearch(runnerB, 'B', MusicSearchScope.All, 1, false)

  resolveB([song('b')])
  await pendingB
  assert.deepEqual(ids(), ['b'], 'B 的结果应写回')

  resolveA([song('a')]) // A 迟到
  await pendingA
  assert.deepEqual(ids(), ['b'], '过期的 A 不得覆盖 B 的结果')
  assert.equal(getSearchState().query, 'B')
  assert.equal(getSearchState().loading, false)
})

test('追加分页：append=true 拼接结果并推进页码', async () => {
  await runSearch(async () => [song('1'), song('2')], 'x', MusicSearchScope.All, 1, false)
  await runSearch(async () => [song('3')], 'x', MusicSearchScope.All, 2, true)

  const state = getSearchState()
  assert.deepEqual(ids(), ['1', '2', '3'])
  assert.equal(state.page, 2)
  assert.equal(state.loadingMore, false)
  assert.equal(state.loading, false)
  assert.equal(state.error, null)
})

test('追加失败：保留已有结果，只设置 error', async () => {
  await runSearch(async () => [song('1'), song('2')], 'x', MusicSearchScope.All, 1, false)
  await runSearch(
    async () => {
      throw new Error('网络错误')
    },
    'x',
    MusicSearchScope.All,
    2,
    true,
  )

  const state = getSearchState()
  assert.deepEqual(ids(), ['1', '2'], '加载更多失败不应清空已有结果')
  assert.equal(state.error, '网络错误')
  assert.equal(state.loadingMore, false)
  assert.equal(state.page, 1, '失败时页码不推进')
})

test('空关键词：不发请求、状态清空，但 scope 仍被更新', async () => {
  let calls = 0
  await runSearch(
    async () => {
      calls += 1
      return [song('1')]
    },
    '先搜一次',
    MusicSearchScope.All,
    1,
    false,
  )
  assert.equal(calls, 1)

  await runSearch(
    async () => {
      calls += 1
      return [song('9')]
    },
    '   ',
    MusicSearchScope.ChkszSongs,
    1,
    false,
  )
  assert.equal(calls, 1, '空关键词不得发请求')

  const state = getSearchState()
  assert.equal(state.query, '')
  assert.deepEqual(state.results, [])
  assert.equal(state.page, 1)
  assert.equal(state.error, null)
  assert.equal(state.loading, false)
  assert.equal(state.loadingMore, false)
  assert.equal(state.scope, MusicSearchScope.ChkszSongs, 'scope 仍应更新')
})

test('空关键词：只发布一次，不出现 loading/loadingMore 中间态', async () => {
  const snapshots: SearchState[] = []
  const unsubscribe = subscribeSearch(() => snapshots.push(getSearchState()))

  let calls = 0
  await runSearch(
    async () => {
      calls += 1
      return [song('9')]
    },
    '   ',
    MusicSearchScope.ChkszSongs,
    1,
    false,
  )
  unsubscribe()

  assert.equal(calls, 0, '空关键词不得发请求')
  assert.equal(snapshots.length, 1, '空关键词应只发布一次（不要先发 loading 再发复位）')
  assert.ok(
    snapshots.every((s) => !s.loading && !s.loadingMore),
    '不得出现 loading / loadingMore 中间态',
  )

  const last = getSearchState()
  assert.equal(last.query, '')
  assert.deepEqual(last.results, [])
  assert.equal(last.page, 1)
  assert.equal(last.error, null)
  assert.equal(last.scope, MusicSearchScope.ChkszSongs, 'scope 仍应更新')
})

test('空关键词 + append=true：也走完整复位（清空结果、页码回 1）', async () => {
  await runSearch(async () => [song('1'), song('2')], 'x', MusicSearchScope.All, 1, false)
  assert.equal(getSearchState().results.length, 2)

  let calls = 0
  await runSearch(
    async () => {
      calls += 1
      return [song('9')]
    },
    '  ',
    MusicSearchScope.All,
    2,
    true,
  )
  assert.equal(calls, 0, '空关键词不得发请求')

  const state = getSearchState()
  assert.deepEqual(state.results, [], 'append 形式的空关键词也要清空结果，而不是保留')
  assert.equal(state.page, 1)
  assert.equal(state.error, null)
  assert.equal(state.loading, false)
  assert.equal(state.loadingMore, false)
  assert.equal(state.query, '')
})

test('错误映射：ChKSz / api key → CHKSZ_KEY_MISSING，其余原样', async () => {
  await runSearch(
    async () => {
      throw new Error('ChKSz 未配置 API Key')
    },
    'x',
    MusicSearchScope.All,
    1,
    false,
  )
  assert.equal(getSearchState().error, CHKSZ_KEY_MISSING)
  assert.equal(getSearchState().loading, false)
  assert.deepEqual(getSearchState().results, [])

  await runSearch(
    async () => {
      throw new Error('Invalid API Key provided')
    },
    'x',
    MusicSearchScope.All,
    1,
    false,
  )
  assert.equal(getSearchState().error, CHKSZ_KEY_MISSING, '大小写不敏感')

  await runSearch(
    async () => {
      throw new Error('搜索接口 500')
    },
    'x',
    MusicSearchScope.All,
    1,
    false,
  )
  assert.equal(getSearchState().error, '搜索接口 500', '其它错误原样保留')

  await runSearch(
    async () => {
      throw 'plain string failure'
    },
    'x',
    MusicSearchScope.All,
    1,
    false,
  )
  assert.equal(getSearchState().error, 'plain string failure', '非 Error 也要转成字符串')
})

test('setSearchTab：同值不发布；resetSearch 保留 tab/scope 并让在途响应失效', async () => {
  let notifications = 0
  const unsubscribe = subscribeSearch(() => {
    notifications += 1
  })

  setSearchTab('playlist')
  assert.equal(getSearchState().tab, 'playlist')
  const afterFirst = notifications

  setSearchTab('playlist') // 同值：不发布
  assert.equal(notifications, afterFirst, '同值不得重复发布')

  await runSearch(async () => [song('1')], 'x', MusicSearchScope.BilibiliPlaylists, 1, false)
  assert.equal(getSearchState().results.length, 1)

  resetSearch()
  const state = getSearchState()
  assert.equal(state.query, '')
  assert.deepEqual(state.results, [])
  assert.equal(state.page, 1)
  assert.equal(state.error, null)
  assert.equal(state.loading, false)
  assert.equal(state.loadingMore, false)
  assert.equal(state.tab, 'playlist', 'reset 保留选中的 Tab')
  assert.equal(state.scope, MusicSearchScope.BilibiliPlaylists, 'reset 保留音源范围')

  unsubscribe()

  // reset 之后，reset 之前发起的在途响应回来也不得写状态
  let resolveStale!: (songs: Song[]) => void
  const pending = runSearch(
    () =>
      new Promise<Song[]>((resolve) => {
        resolveStale = resolve
      }),
    'stale',
    MusicSearchScope.All,
    1,
    false,
  )
  resetSearch()
  resolveStale([song('stale')])
  await pending

  assert.deepEqual(getSearchState().results, [], 'reset 后的过期响应不得回填')
  assert.equal(getSearchState().query, '')
})

test('useSearchState：真实渲染读到 store，未变化时快照引用稳定', async () => {
  const captured: Array<ReturnType<typeof useSearchState>> = []
  function Probe() {
    captured.push(useSearchState())
    return createElement('span', null, String(captured[captured.length - 1].results.length))
  }
  const read = () => {
    captured.length = 0
    renderToStaticMarkup(createElement(Probe))
    return captured[0]
  }

  await runSearch(async () => [song('1'), song('2')], 'hook', MusicSearchScope.All, 1, false)

  const first = read()
  assert.equal(first.query, 'hook')
  assert.equal(first.results.length, 2)

  const second = read()
  assert.equal(second, first, '状态未变化时快照引用应稳定')
})
