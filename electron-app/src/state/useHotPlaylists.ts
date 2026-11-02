/**
 * 首页「热门歌单」的取数与轮换 —— 把 ./hotRotation.ts 的纯逻辑接到 MusicService 上。
 * 移植自 my-music-new apps/mobile/hooks/useHotPlaylists.ts，负责三件页面不该操心的事：
 *
 * 1. **同一进程内只取一次首屏**：冷启动由持久化游标决定从哪个窗口开始，
 *    之后路由切换 / 专注模式往返导致的组件重挂载都沿用同一批
 *    （体验稳定，也不重复发请求）。
 * 2. **「换一批」真的换**：游标前进 → 换分类（必要时翻更深页）→ 跨批排除
 *    已经展示过的歌单 id。绝不把上一批在本地重排一遍当成「新的」。
 * 3. **诚实**：「没新内容」与「没取到数据」必须分开 —— 只有真拿到过候选、却全被
 *    跨批历史排除时才提示「已轮完一轮」；请求失败 / 上游回 200+空列表属于「没取到
 *    数据」，保留旧列表与全部去重历史、游标原地重试（下次点击重试同一窗口），
 *    绝不把网络故障说成用尽。没有旧列表时先回落老的 `getHotPlaylists()`，
 *    兜底之后仍从失败的那个窗口重试。
 *
 * 数据源事实（2026-10 实测，详见 ./hotRotation.ts 头部）：
 * `cat=全部` 的 order=hot 服务端完全稳定（连续请求 id 序列一模一样），
 * 所以首屏之所以「永远一样」正是固定请求它；换分类才是真变化源。
 *
 * 桌面端相对移动端的差异：
 * - 对外契约不含 window（页面只需要 sourceLabel）；窗口只作为内部游标状态保留。
 * - 桌面 `getHotPlaylists()` 走 Hybrid provider，元数据源超时后可能回 B 站热单 ——
 *   兜底批次的来源标签按条目真实 sourceLabel 写（describeFallbackSource），
 *   绝不把 B 站内容标成「网易云」。
 * - 跨批去重历史有硬上界（HOT_WINDOW_COUNT × HOME_HOT_LIMIT，boundShownIds），
 *   且绝不丢当前屏 id；移动端只靠 exhausted 时把历史收缩成当前屏。
 *
 * StrictMode / 路由往返安全性：
 * - 每次请求持 reqRef 序号，过期响应（含已卸载实例迟到的响应）直接丢弃，
 *   不会覆盖新状态，也不会污染模块级 session；
 * - 卸载清理把 reqRef 作废；重挂载时 session 仍为空会重新发起首屏加载，
 *   session 已有批次则直接复用 —— 两条路径 loading 都会收敛，不会卡死。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  DEFAULT_HOT_LIMIT,
  HOT_WINDOW_COUNT,
  advanceHotCursor,
  boundShownIds,
  fillHotPlaylists,
  hotWindowFor,
  nextHotCursor,
  normalizeHotCursor,
  selectHotPlaylists,
  type FillHotPlaylistsResult,
  type HotPlaylistLike,
  type HotWindow,
} from './hotRotation'
import { showNotice } from './notice'
import { toSongs } from './songUtils'
import type { Song } from '../services/models'
import type { RawSong } from '../services/musicProvider'
import type { MusicService } from '../services/musicService'

/** 一次展示几个（与首页歌单网格一屏 10 个一致） */
export const HOME_HOT_LIMIT = DEFAULT_HOT_LIMIT

/** 跨批去重历史上限：一整轮窗口 × 每批条数（有界，且足够覆盖完整一轮轮换） */
const SHOWN_IDS_CAP = HOT_WINDOW_COUNT * HOME_HOT_LIMIT

/**
 * 会话级缓存 —— 模块级而不是 useState。
 *
 * 为什么：DeskRoute 切换视图、进出专注模式都会卸载重建首页组件，
 * 放在 useState 里的「当前这一批 + 已经从哪个游标取的」会一起丢掉，
 * 表现就是「切个页面回来热门歌单又变成另一批」—— 而这正好是要避免的跳变。
 */
export interface HotSession {
  /** 当前展示的这一批 */
  items: Song[]
  /**
   * 这一批的锚点窗口（只参与游标推进的兜底计算，不直接展示）。
   *
   * 兜底批次（getHotPlaylists）没有对应分类窗口，记的仍是**本批起点** ——
   * 记成窗口 0 会让兜底之后的「换一批」偷偷退回开头，而不是从失败处重试。
   */
  window: HotWindow
  /** 展示用的来源说明（兜底批次无法从窗口推导，所以单独存） */
  label: string
  /** 本次会话累计展示过的 id（跨批去重口径，有界） */
  shownIds: string[]
}

let session: HotSession | null = null
/** 冷启动游标：一个进程只推进一次（advanceHotCursor 会写盘） */
let sessionStartCursor: number | null = null
/**
 * 下一批从哪个游标开始（**不是** `session.window.cursor`，两者刻意的差别见 load()）。
 *
 * 为什么单独记：
 *   - `fillHotPlaylists` 一次可能吃掉 2–3 个窗口（主窗口取不满时补），
 *     只对 window.cursor +1 会让下一批把已经问过的窗口再问一遍；
 *   - 去重耗尽（exhausted）时也必须前进：cursor 是纯函数输入，停在原地就会永久撞
 *     同一批老面孔；
 *   - **但请求失败 / 上游空响应（unavailable）时绝不能前进**：用户一个条目都没看到，
 *     前进等于把没看过的窗口跳过（网络抖动时连点几次还能白走一整轮）。这时它保持在
 *     本批起点，下次点击就是「原地重试同一窗口」。
 */
let sessionNextCursor: number | null = null
/**
 * 本轮已经确认「所有尝试窗口都成功、候选全是已展示过的旧面孔」的窗口游标。
 *
 * 为什么要它：`fillHotPlaylists` 一次只问最多 3 个窗口，`result.exhausted` 只能证明
 * **这 3 个**窗口没新面孔；一轮却有 `HOT_WINDOW_COUNT`（39）个窗口。若一批就说
 * 「已轮完一轮」并收缩 shownIds，其余 36 个窗口里可能的新歌单没看到，之前看过的
 * 1–20 却会过早重新上屏。所以累计到 39 个不同窗口后才算真的一轮。
 *
 * 有界：只存 0..HOT_WINDOW_COUNT-1 的游标，生命周期 = 模块会话（与 session 同步复位）。
 */
let exhaustedWindows = new Set<number>()

/** 仅供测试/调试：清空会话缓存（含本轮「已确认无新面孔」的窗口累计） */
export function resetHotSessionForTests(): void {
  session = null
  sessionStartCursor = null
  sessionNextCursor = null
  exhaustedWindows = new Set()
}

/**
 * 本批「吃到」了哪些窗口 → 下一批该从哪个游标开始。
 *
 * `windows` 只含**成功**窗口（见 fillHotPlaylists）：正常情况 = [主窗口]，只前进一格；
 * 主窗口取不满时补问的窗口也一起跳过，免得下一批重复请求。一个窗口都没有时退化成 +1，
 * 保证空输入下也能往前走一格 —— unavailable（失败/空响应）不走这里，它在原地重试。
 */
function cursorAfter(windows: readonly HotWindow[], fallback: number): number {
  const last = windows[windows.length - 1]
  return nextHotCursor(last != null ? last.cursor : fallback)
}

function startCursor(): number {
  if (sessionStartCursor == null) {
    try {
      sessionStartCursor = advanceHotCursor()
    } catch {
      sessionStartCursor = 0
    }
  }
  return sessionStartCursor
}

export interface UseHotPlaylistsResult {
  /** 当前这一批歌单（可能少于 HOME_HOT_LIMIT，宁可少也不重摆） */
  playlists: Song[]
  /** 首屏加载中（还没有任何内容） */
  loading: boolean
  /** 换一批加载中 */
  refreshing: boolean
  /** 「网易云 · 华语」这样的短说明（只写真实分类名，不写第几页）；未加载时为 '' */
  sourceLabel: string
  /** 换一批：真的换到下一批；已经轮完一轮时提示并保留当前内容 */
  next: () => Promise<void>
}

/**
 * 一批内容的来源说明 —— 以**实际贡献过内容的分类集合**为准。
 *
 * 为什么不是单个窗口：补窗时一批可能跨分类（主窗口整窗被滤光后，
 * 4 条来自「华语」、6 条来自「民谣」），只写第一个分类就是把民谣内容说成华语。
 * 单个分类照原名（「网易云 · 华语」）；多个分类并列（「网易云 · 华语 / 民谣」，
 * 补窗上限 3 个窗口，标签长度有界）。空集 / 全空白 → ''。
 *
 * 分类名必须**原样照抄**请求参数（`全部` 就写「全部」，不换「热榜」这类编辑化措辞），
 * 也不挂第几页/第几轮 —— 标签的唯一职责是说明「这批内容真的来自哪个分类」。
 */
export function describeHotCategories(categories: readonly string[]): string {
  const unique: string[] = []
  for (const category of categories) {
    const text = category.trim()
    if (text !== '' && !unique.includes(text)) unique.push(text)
  }
  if (unique.length === 0) return ''
  return `网易云 · ${unique.join(' / ')}`
}

/**
 * 兜底批次（getHotPlaylists）的来源说明 —— 按条目自己的 sourceLabel 如实写。
 *
 * 桌面 Hybrid 的 getHotPlaylists 是元数据源优先、播放源兜底：GDStudio/Meting
 * 超时后会回 B 站关键词热单。这时若沿用移动端写法标「网易云 · 全部」，
 * 就是把 B 站内容标成网易云 —— 比不写更糟。
 *
 * 口径：单一来源 → 「B站 · 热门」；混合来源 → 「网易云 / B站 · 热门」；
 * 条目都没带标签 → 「热门」。
 */
export function describeFallbackSource(items: readonly RawSong[]): string {
  const labels: string[] = []
  for (const item of items) {
    const text = String(item['sourceLabel'] ?? '').trim()
    if (text !== '' && !labels.includes(text)) labels.push(text)
  }
  if (labels.length === 0) return '热门'
  return `${labels.join(' / ')} · 热门`
}

/**
 * 「这一批没有内容」的三种真实原因 —— 提示文案必须分开。
 *
 * 把「没取到数据」说成「轮完了」，用户会以为真的翻到底了，而实际只是限流/断网，
 * 下一次点击就会恢复；反过来静默失败又让人以为按钮坏了。
 */
export const HOT_NOTICE_REFRESH_FAILED = '热门歌单刷新失败，请稍后再试'
export const HOT_NOTICE_UNAVAILABLE = '热门歌单暂时不可用，请稍后再试'
export const HOT_NOTICE_BATCH_STALE = '本批暂无新歌单，请继续换一批'
export const HOT_NOTICE_ROUND_DONE = '热门歌单已轮完一轮，回到开头继续推荐'

/**
 * 一批取回结果 → 页面接下来该做什么（纯决策，hook 只负责把它落到状态/提示上）。
 *
 * 为什么要把分支抽出来：这里有三种「这一批没有内容」必须分开处理（请求失败 /
 * 上游空响应或无有效候选 / 全是旧面孔），混在一起正是本次评审发现的真 bug ——
 * 限流回 200+空列表时误报「已轮完一轮」并把跨批历史收缩掉，恢复后旧歌单（1–20）
 * 被重新摆上首页；整批请求失败时仍然推进游标，把用户没看过的窗口悄悄跳过。
 * 抽成纯函数才能在没有 React 运行时的 node --test 里逐条锁住。
 */
export type HotBatchDecision<T extends HotPlaylistLike> =
  | {
      /** 有新内容：上屏（可能少于 HOME_HOT_LIMIT，少几张比空一屏好） */
      kind: 'fill'
      items: readonly T[]
      /** 实际贡献过内容的分类（展示口径） */
      sourceCategories: string[]
      /** 下一批起点：按实际消费的成功窗口推进 */
      nextCursor: number
      /** 本批之后的「已确认无新面孔」窗口集合：有新内容上屏即清空（= []） */
      coveredWindows: number[]
    }
  | {
      /** 本批窗口都是旧面孔：累加窗口，覆盖完一整轮才算「轮完一轮」 */
      kind: 'exhausted'
      nextCursor: number
      notice: string
      /**
       * 本批之后的累计集合（归一化到 0..HOT_WINDOW_COUNT-1，长度有界）。
       * 覆盖完整一轮时返回 `[]`（累计清零，下一轮从本批起重新计）。
       */
      coveredWindows: number[]
      /** 本批并入后累计覆盖过多少个不同窗口（覆盖完整一轮时 = HOT_WINDOW_COUNT） */
      coveredCount: number
      /** 是否已覆盖完整一轮（HOT_WINDOW_COUNT 个不同窗口）—— 只有这时才允许收缩历史 */
      roundComplete: boolean
    }
  | {
      /** 没取到数据（请求失败 / 上游空响应）：保留旧内容、全部历史与已记窗口，原地重试 */
      kind: 'unavailable'
      nextCursor: number
      notice: string
    }

/** 窗口游标集合归一：只收 `0..HOT_WINDOW_COUNT-1` 的整数（集合因此天然有界） */
function normalizeCoveredWindows(cursors: Iterable<number>): Set<number> {
  const result = new Set<number>()
  for (const cursor of cursors) {
    if (Number.isInteger(cursor) && cursor >= 0 && cursor < HOT_WINDOW_COUNT) result.add(cursor)
  }
  return result
}

export function decideHotBatch<T extends HotPlaylistLike>(
  result: FillHotPlaylistsResult<T> | null,
  startCursor: number,
  coveredWindows: Iterable<number> = [],
): HotBatchDecision<T> {
  // 有内容就上屏：部分窗口失败不影响已经拿到的这几个；本轮累计到此作废
  if (result != null && result.items.length > 0) {
    return {
      kind: 'fill',
      items: result.items,
      sourceCategories: result.sourceCategories,
      nextCursor: cursorAfter(result.windows, startCursor),
      coveredWindows: [],
    }
  }
  // 真拿到过候选、只是全被跨批历史排除（且每个窗口都成功、都给过候选）
  if (result != null && result.exhausted) {
    const covered = normalizeCoveredWindows(coveredWindows)
    for (const window of result.windows) covered.add(window.cursor)
    /*
      只有覆盖完一整轮不同窗口（39 个）才敢说「轮完一轮」：一批最多 3 个窗口，
      刚翻 3 个就说「轮完一轮」等于宣告其余 36 个窗口不存在 —— 用户会看到旧歌单
      过早重复，而真正的新歌单一次都没看。没覆盖完时只累加窗口、保留全部历史。
    */
    const roundComplete = covered.size >= HOT_WINDOW_COUNT
    return {
      kind: 'exhausted',
      nextCursor: cursorAfter(result.windows, startCursor),
      notice: roundComplete ? HOT_NOTICE_ROUND_DONE : HOT_NOTICE_BATCH_STALE,
      // 覆盖完整一轮 → 累计清零（下一个窗口重新计），否则继续累加
      coveredWindows: roundComplete ? [] : [...covered],
      coveredCount: covered.size,
      roundComplete,
    }
  }
  /*
    剩下的都是「这一批没拿到数据」：旧列表 + 全部去重历史 + 起始游标一律不动。
    （也不往「已确认无新面孔」里记窗口：失败的窗口什么都没拿到，不能当成翻过了。）

    文案要看是不是真有窗口失败：
      - 有失败（含整批失败 / fillHotPlaylists 本身抛错）→ 刷新失败；
      - 窗口都成功，但回了空列表 / 全是无效条目（限流常回 200 + `[]`）→ 暂时不可用。
  */
  const failed = result == null || result.attemptedWindows.length > result.okWindows
  return {
    kind: 'unavailable',
    // 原地重试：cursor 是纯函数输入，前进就等于把用户没看过的窗口跳过
    nextCursor: normalizeHotCursor(startCursor),
    notice: failed ? HOT_NOTICE_REFRESH_FAILED : HOT_NOTICE_UNAVAILABLE,
  }
}

/** RawSong 是松散 map，id 统一归一（空/空白返回 ''） */
function rawId(item: RawSong): string {
  return String(item['id'] ?? '').trim()
}

/**
 * 兜底批次（`getHotPlaylists`）→ 会话批次；一条可用条目都没有时返回 null。
 *
 * 锚点必须记**本批起点窗口**（而不是窗口 0）：兜底内容来自固定热榜、不对应任何
 * 分类窗口，若记成窗口 0，兜底之后的「换一批」会偷偷退回开头 —— 正确行为是从这次
 * 失败/空响应的那个窗口重试（首屏兜底不能把起始游标丢掉）。
 */
export function buildFallbackBatch(
  lists: readonly RawSong[],
  startWindow: HotWindow,
): HotSession | null {
  const fallback = selectHotPlaylists(lists, { limit: HOME_HOT_LIMIT })
  if (fallback.length === 0) return null
  return {
    items: toSongs(fallback),
    window: startWindow,
    // 来源标签必须按兜底条目的真实 sourceLabel 写，不能沿用起始窗口的分类 ——
    // 桌面兜底可能是 B 站内容，标「网易云 · 全部」就是替数据源化妆。
    label: describeFallbackSource(fallback),
    shownIds: boundShownIds([], fallback.map(rawId), SHOWN_IDS_CAP),
  }
}

/** 取一个窗口（musicService 已兜空 id 过滤，NeteasePublicClient 有空结果不缓存口径） */
async function fetchWindowRows(music: MusicService, win: HotWindow): Promise<RawSong[]> {
  return music.getCategoryPlaylists(win.category, {
    limit: win.limit,
    offset: win.offset,
  })
}

export function useHotPlaylists(music: MusicService): UseHotPlaylistsResult {
  const [items, setItems] = useState<Song[]>(() => session?.items ?? [])
  const [label, setLabel] = useState(() => session?.label ?? '')
  const [loading, setLoading] = useState(() => session == null)
  const [refreshing, setRefreshing] = useState(false)

  /** 请求序号：过期响应直接丢弃（与首页推荐区同一套做法） */
  const reqRef = useRef(0)

  const apply = useCallback((next: HotSession) => {
    session = next
    setItems(next.items)
    setLabel(next.label)
  }, [])

  /**
   * 载入一批。
   *
   * @param cursor     从哪个窗口开始
   * @param excludeIds 跨批排除的 id（换一批时 = 本会话已展示过的）
   * @param mode       initial=首屏（有 loading），refresh=换一批（有 refreshing）
   */
  const load = useCallback(
    async (cursor: number, excludeIds: string[], mode: 'initial' | 'refresh') => {
      const requestId = ++reqRef.current
      if (mode === 'initial') setLoading(true)
      else setRefreshing(true)

      const startWindow = hotWindowFor(cursor, HOME_HOT_LIMIT)
      let result: FillHotPlaylistsResult<RawSong> | null = null
      try {
        result = await fillHotPlaylists<RawSong>({
          startCursor: cursor,
          limit: HOME_HOT_LIMIT,
          excludeIds,
          fetchWindow: (window) => fetchWindowRows(music, window),
        })
      } catch {
        result = null
      }
      // 过期响应（更新的请求已发出 / 组件已卸载）直接丢弃，不碰任何状态与 session
      if (requestId !== reqRef.current) return

      // 结局判定全交给纯函数：三种「没有内容」的处理方式完全不同，见 decideHotBatch。
      // exhaustedWindows 传进去是为了回答「这 3 个窗口之外的一整轮都确认过了吗」。
      const decision = decideHotBatch(result, cursor, exhaustedWindows)
      // 下一批的起点：fill/exhausted 按实际消费的窗口前进；unavailable 停在本批起点，
      // 下次点击就是「原地重试同一窗口」（网络故障不能把没看过的窗口跳过）。
      sessionNextCursor = decision.nextCursor

      /*
        `getHotPlaylists()` 兜底（桌面走 Hybrid provider 链，内容可能来自 B 站）。

        只在「还没有任何内容可看」时用：首屏请求失败 / 上游回空列表，以及首屏之后
        再点「换一批」仍然没拿到内容。兜底不影响游标 —— sessionNextCursor 上面已经
        指向本批起点，兜底之后的「换一批」会从失败的那个窗口重试，而不是退回窗口 0。
      */
      const applyFallback = async (): Promise<boolean> => {
        if (session != null) return false
        try {
          const lists = await music.getHotPlaylists({ limit: HOME_HOT_LIMIT })
          if (requestId !== reqRef.current) return false
          const batch = buildFallbackBatch(lists, startWindow)
          if (batch == null) return false
          apply(batch)
          // 兜底内容也是「新内容上屏」：本轮「已确认无新面孔」的累计作废
          exhaustedWindows = new Set()
          return true
        } catch {
          /* 兜底也失败：页面显示空态 */
          return false
        }
      }

      if (decision.kind === 'fill') {
        // 有新内容上屏：上一轮「已确认无新面孔」的累计不再成立（否则会把历史过早收缩）。
        exhaustedWindows = new Set(decision.coveredWindows)
        // 来源必须写“真的贡献了内容的窗口”，不是“起始窗口”：
        // fillHotPlaylists 会在主窗口整窗被 excludeIds 过滤掉、或主窗口请求失败时
        // 继续问下一个窗口，那些情况下内容来自后面那个分类。
        // 标签以「所有贡献分类」为准（sourceCategories）：补窗跨分类时只写第一个
        // 分类就是把别的分类的内容误标。
        const source = result?.sourceWindow ?? startWindow
        apply({
          items: toSongs([...decision.items]),
          window: source,
          label: describeHotCategories(
            decision.sourceCategories.length > 0
              ? decision.sourceCategories
              : [source.category],
          ),
          shownIds: boundShownIds(excludeIds, decision.items.map(rawId), SHOWN_IDS_CAP),
        })
      } else if (decision.kind === 'exhausted' && session != null) {
        /*
          本批窗口都成功、都真的给过候选，但候选全是已展示过的旧面孔。

          注意「本批都是旧面孔」≠「一整轮翻完了」：一轮有 HOT_WINDOW_COUNT（39）个窗口，
          一批最多看 3 个。所以先把本批窗口记入累计，**只有覆盖完 39 个不同窗口**
          才允许收缩去重历史；否则保留当前歌单与全部历史，提示用户继续换一批
          （收缩历史会让 1–20 这些看过的歌单过早重新上屏，而其余窗口的新内容
          一次都没看到）。
        */
        /*
          exhaustedWindows 直接取决策结果：有新内容时是 `[]`（清零），覆盖完整一轮时
          也是 `[]`（清零，下一轮重新计），未覆盖完时是累加后的集合。一次赋值就同时
          满足「新内容重置」「完整一轮清空」「unavailable 不动」。
        */
        exhaustedWindows = new Set(decision.coveredWindows)
        const kept = session
        if (decision.roundComplete) {
          /*
            整轮确认无新面孔：这时才把跨批排除表收缩成「当前屏幕上的这几个」——
            配合 shownIds 的硬上界，让「换一批」真的能从开头重新开始。
          */
          apply({
            items: kept.items,
            window: kept.window,
            label: kept.label,
            shownIds: boundShownIds([], kept.items.map((song) => song.id), SHOWN_IDS_CAP),
          })
        }
        showNotice(decision.notice)
      } else if (session == null) {
        // 还没有任何内容可看：先试 getHotPlaylists 兜底
        await applyFallback()
        // await 边界之后必须再判一次序号：等待期间组件可能已卸载 / 新请求已发出，
        // 此时模块级 session 可能已被新实例写入 —— 继续往下走会让旧实例的
        // apply/提示盖到新会话上（applyFallback 内部的序号检查只保护它自己那段）。
        if (requestId !== reqRef.current) return
      } else {
        /*
          已有批次但没有新内容可上屏（请求失败 / 上游空响应）：旧列表、**全部**跨批
          去重历史、已记窗口一律原样保留，只提示这次真的没取到 —— 既不能静默失败，
          也不能说成「已轮完一轮」（那是另一回事，见上一条分支）。清掉历史会让恢复后
          把 1–20 这些已经看过的歌单重新摆回首页。
        */
        showNotice(decision.notice)
      }

      if (requestId === reqRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [apply, music],
  )

  // 首屏：会话里已有批次就直接复用（路由/专注模式往返不跳变、不重复请求）
  useEffect(() => {
    if (session != null) return
    void load(startCursor(), [], 'initial')
  }, [load])

  // 卸载让在途请求失效（过期响应不会复写状态，也不会污染 session）
  useEffect(
    () => () => {
      reqRef.current += 1
    },
    [],
  )

  const next = useCallback(async () => {
    // 首屏还在路上时忽略：既避免两条请求互相作废（首屏那次的响应会被丢掉，
    // 而它的 loading 也不会再有人复位），也避免「换一批」把首屏窗口白白消耗掉。
    if (loading || refreshing) return
    const current = session
    // 起点用「上一批吃到哪儿」而不是 window.cursor：fillHotPlaylists 一次可能
    // 问 2–3 个窗口，整批落空时也没有新 window 可读。请求失败/空响应时
    // sessionNextCursor 停在本批起点 —— 这里就是「原地重试同一窗口」的入口。
    const from = sessionNextCursor ?? current?.window.cursor ?? startCursor()
    await load(from, current?.shownIds ?? [], 'refresh')
  }, [load, loading, refreshing])

  return {
    playlists: items,
    loading,
    refreshing,
    sourceLabel: label,
    next,
  }
}
