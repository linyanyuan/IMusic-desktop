/**
 * 首页「热门歌单」的轮换窗口 —— 纯函数，无 React / 无网络依赖。
 * 移植自 my-music-new packages/core/src/state/hotRotation.ts（行为口径保持一致）。
 *
 * 为什么需要它（2026-10 对 music.163.com 公开接口的实测）：
 *
 * 1. **旧实现永远请求同一批**：桌面端 HomeView 固定向 `getHotPlaylists` 要
 *    「第 N 批」（offset 单调 +10），回到 offset 0 又是同一批；而 `全部` 的
 *    `order=hot` 在服务端**完全稳定**（同一 URL 连请求 4 次 id 序列一模一样，
 *    加 cache-buster / no-cache 也不变），NeteasePublicClient 还有 30 分钟内存
 *    缓存 —— 于是「每次进首页都是同一批歌单」。
 * 2. **真正的变化源在分类维度**：`cat=华语/粤语/民谣/说唱/轻音乐/ACG…` 的
 *    `order=hot` 每次请求返回热池里的一个随机样本（实测同一 offset 连请求两次，
 *    10 条只重叠 0–1 条），深度也够（offset 0/10/30/90 都正常返回 10 条）。
 *    所以「有变化」应当来自**换分类 + 真翻页**，而不是把同一批 10 个在本地重排——
 *    后者就是「用纯随机掩盖数据源不足」。
 * 3. **但不能全交给服务端随机**：那样同一次使用里进进出出都不一样，体验不稳。
 *    因此这里用**确定性游标**：一个整数 cursor → (分类, 页轮)，全程没有
 *    Math.random。会话内 cursor 不变（稳定），冷启动「换一批」再前进（有变化），
 *    到末尾回绕。每条分支都能在 node 下测到。
 *
 * 与分类详情页的关系：**刻意不依赖它**。分类页有自己的一套分页状态机
 * （CategoryView 按 id + 标题歌手去重、还要管加载更多），那套口径服务于
 * 「同一个分类里翻很多页」；首页这里只是「一批 10 个歌单」，只需要 id 唯一 +
 * 不重摆上一批。两个职责分开，谁改都不会打断对方。
 */

import { FEATURED_CATEGORIES } from './featured'
import { createDefaultStorage, type KeyValueStorage } from '../services/storage'

/**
 * 轮换用的分类池。
 *
 * - 第一项是 `全部`：网易云的编辑精选热榜（服务端稳定、跨分类混杂），
 *   作为「热门歌单」的基准口味保留；
 * - 其余复用 `FEATURED_CATEGORIES`（已有单测保证每个名字都真实存在于
 *   `/api/playlist/catalogue`，写错名字接口会直接返回空列表）。
 */
export const HOT_CATEGORIES: readonly string[] = ['全部', ...FEATURED_CATEGORIES]

/**
 * 每个分类最多向深处翻几轮（0/1/2 → offset 0/limit/2·limit）。
 *
 * 分类热池本身有几千个歌单、服务端又随机取样，翻太深只会拿到更冷门的歌单，
 * 收益递减；3 轮（13 个分类 × 3 = 39 个窗口）足够轮很久，也让游标有界。
 */
export const HOT_PAGE_ROUNDS = 3

/** 一轮完整循环有多少个窗口（cursor 的取值周期） */
export const HOT_WINDOW_COUNT = HOT_CATEGORIES.length * HOT_PAGE_ROUNDS

/** 默认每屏取几个歌单（与首页网格 10 个一致） */
export const DEFAULT_HOT_LIMIT = 10

/** 持久化 key（桌面端走 localStorage，无移动端 PRELOAD_KEYS 白名单一说） */
export const HOT_CURSOR_STORAGE_KEY = 'home_hot_cursor'

const MS_PER_DAY = 86_400_000

/** 一个窗口 = 一次 `getCategoryPlaylists(cat, {limit, offset})` 请求 */
export interface HotWindow {
  /** 归一化后的游标（0..HOT_WINDOW_COUNT-1） */
  cursor: number
  /** 网易云分类名，直接作为 `cat` 参数 */
  category: string
  /** 该分类内的偏移（按 limit 翻轮） */
  offset: number
  /** 本窗口请求条数 */
  limit: number
  /** 第几轮（0 基）：0 是分类首页，1/2 是同一分类的更深页 */
  round: number
}

/** 把任意输入折进 [0, HOT_WINDOW_COUNT) —— 负数、NaN、小数都安全 */
export function normalizeHotCursor(cursor: number): number {
  if (!Number.isFinite(cursor)) return 0
  const value = Math.floor(cursor)
  return ((value % HOT_WINDOW_COUNT) + HOT_WINDOW_COUNT) % HOT_WINDOW_COUNT
}

/** 下一个窗口游标（末尾回绕到 0） */
export function nextHotCursor(cursor: number): number {
  return normalizeHotCursor(normalizeHotCursor(cursor) + 1)
}

/**
 * 游标 → 具体窗口。
 *
 * 映射规则：先按分类铺开，再整体下沉一轮。也就是
 * `全部 → 华语 → 欧美 → … → ACG → 全部(offset 10) → 华语(offset 10) → …`。
 * 这样连续几次「换一批」看到的是**不同分类**（观感差别最大），
 * 一轮吃完才回到同一分类的更深页。
 */
export function hotWindowFor(cursor: number, limit: number = DEFAULT_HOT_LIMIT): HotWindow {
  const safeLimit = Math.max(
    1,
    Math.floor(Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_HOT_LIMIT),
  )
  const normalized = normalizeHotCursor(cursor)
  const round = Math.floor(normalized / HOT_CATEGORIES.length)
  const category = HOT_CATEGORIES[normalized % HOT_CATEGORIES.length] as string
  return { cursor: normalized, category, offset: round * safeLimit, limit: safeLimit, round }
}

/**
 * 从某个游标开始的连续窗口（用于「一个窗口取不满时再补一个」）。
 *
 * 返回的第一个元素永远是 `hotWindowFor(startCursor)`，调用方先把主窗口的结果
 * 用掉，缺了再按顺序请求后面几个 —— 正常情况下只发 1 个请求。
 */
export function hotWindowCandidates(
  startCursor: number,
  limit: number,
  count: number,
): HotWindow[] {
  const size = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1))
  const result: HotWindow[] = []
  let cursor = normalizeHotCursor(startCursor)
  for (let i = 0; i < size; i++) {
    result.push(hotWindowFor(cursor, limit))
    cursor = nextHotCursor(cursor)
  }
  return result
}

/**
 * 只保留 UI 真正能用的字段做判定。
 *
 * 注意字段刻意是 `unknown`：桌面服务层的 `RawSong = Record<string, unknown>`，
 * 约束写成 `id: string` 会让 `fillHotPlaylists<RawSong>` 过不了泛型约束；
 * 真正的判定全部走 hotPlaylistKey 的 String() 归一。
 */
export interface HotPlaylistLike {
  id?: unknown
  title?: unknown
  resultType?: unknown
}

/**
 * 歌单的唯一身份：**只有 id**。
 *
 * 同名不同 id 是两张不同歌单，绝不能按标题去重（会把真实差异吞掉）；
 * id 为空**或前缀后没有载荷**（`bilibili:` / `gdstudio::`）都视为不可用。
 *
 * 为什么必须同时判载荷：这些 id 是 provider 拼串时上游字段缺失留下的
 * （见 bilibili.ts「会生成 `bilibili:` 这种空 id 流入 UI」）。只判整串空白时
 * `'bilibili:'` 自己非空，于是通过 selectHotPlaylists 的空 id 过滤被摆上首页，
 * 点进去必然落到无效 id —— 与本文档声明的口径矛盾。
 */
export function hotPlaylistKey(item: { id?: unknown }): string {
  const id = item?.id == null ? '' : String(item.id).trim()
  if (id === '') return ''
  // 最后一个分隔符后的段就是载荷：`bilibili:` / `gdstudio::` 的载荷为空串
  const payload = id.slice(id.lastIndexOf(':') + 1)
  return payload === '' ? '' : `id:${id}`
}

/**
 * 单条候选是否「摆得上首页」：歌单类型 + 有载荷的 id。
 *
 * `selectHotPlaylists`（能不能上屏）与 `fillHotPlaylists`（算不算候选，candidateCount）
 * 共用这一份口径，免得「可用」与「算候选」两套判断慢慢漂移。
 */
export function isUsableHotPlaylist(item: HotPlaylistLike | null | undefined): boolean {
  if (item == null) return false
  const resultType = String(item.resultType ?? '').trim()
  if (resultType !== '' && resultType !== 'playlist') return false
  return hotPlaylistKey(item) !== ''
}

export interface SelectHotOptions {
  /** 本批最多取几个，默认 DEFAULT_HOT_LIMIT */
  limit?: number
  /**
   * 已经展示过的歌单 id（「换一批」时传入）：
   * 命中的一律丢掉 —— 宁可这一批少几个，也不把上一批的内容再摆一遍。
   */
  excludeIds?: Iterable<string>
}

/**
 * 过滤 + 去重 + 截断，得到一批可以摆上首页的歌单。
 *
 * 口径：
 * - **id 为空的丢掉**：`bilibili:` 这种空载荷 id 点进去必然失败（不可用）；
 * - **resultType 显式不是 playlist 的丢掉**：这个区块只放歌单；
 * - 同一批内 id 重复的丢掉（上游一页里就可能重复）；
 * - `excludeIds` 里的丢掉（不拿旧内容冒充新内容）。
 */
export function selectHotPlaylists<T extends HotPlaylistLike>(
  items: readonly T[],
  options: SelectHotOptions = {},
): T[] {
  // 非法 limit（未传 / NaN / ≤0）一律回落默认值：
  // 静默夹成 1 会变成「调用方要 0 个却拿到 1 个」这种查不出来的魔数行为。
  const requested = Number(options.limit)
  const limit =
    Number.isFinite(requested) && requested > 0
      ? Math.floor(requested)
      : DEFAULT_HOT_LIMIT
  const blocked = new Set<string>()
  for (const id of options.excludeIds ?? []) {
    const key = hotPlaylistKey({ id })
    if (key !== '') blocked.add(key)
  }

  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    if (result.length >= limit) break
    if (!isUsableHotPlaylist(item)) continue
    const key = hotPlaylistKey(item)
    if (blocked.has(key) || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

/**
 * 一次「取一批首页热门歌单」最多问几个窗口（主窗口取不满时才补）。
 *
 * 正常情况下只发 1 个请求；只在主窗口重样/偏少时才多问 1–2 个。
 * 上限定成 3 是因为再多就变成了「为了凑满 10 个而连发一串请求」，
 * 宁可这一屏少几张，也要让首屏/换一批的等待时间可预测。
 */
export const HOT_MAX_WINDOWS_PER_LOAD = 3

export interface FillHotPlaylistsOptions<T extends HotPlaylistLike> {
  /** 起始游标（本批从哪个窗口开始） */
  startCursor: number
  /** 本批想要几个，默认 DEFAULT_HOT_LIMIT */
  limit?: number
  /** 已经展示过的歌单 id（换一批时传入，避免重摆） */
  excludeIds?: Iterable<string>
  /** 取一个窗口（通常就是 `getCategoryPlaylists(win.category, {limit, offset})`） */
  fetchWindow: (window: HotWindow) => Promise<readonly T[]>
  /** 最多问几个窗口，默认 HOT_MAX_WINDOWS_PER_LOAD */
  maxWindows?: number
}

export interface FillHotPlaylistsResult<T extends HotPlaylistLike> {
  /** 本批歌单（已过滤空 id / 非歌单 / 重复 / 已展示过的） */
  items: T[]
  /**
   * **成功拿回数据**的窗口（按请求顺序）；请求抛错的窗口**不在**这里。
   *
   * 用途是「按实际成功消费的窗口推进游标」，以及给「本轮已确认无新面孔」的窗口记账。
   * 不要理解成「失败窗口一定不会被跳过」：若窗口 0 失败、窗口 1 成功并上屏，
   * 游标会越过窗口 0（从窗口 2 继续）。真正保证的是**整批都没有内容**（unavailable）
   * 时游标原地不动、下次重试同一批窗口（见 useHotPlaylists 的 decideHotBatch）。
   */
  windows: HotWindow[]
  /** 实际发过请求的全部窗口（含失败的，按请求顺序）—— 只用于诊断，不参与游标推进 */
  attemptedWindows: HotWindow[]
  /** 成功拿到了几个窗口的数据（全部失败 = 0，等于 `windows.length`） */
  okWindows: number
  /**
   * 成功窗口里「摆得上首页」的候选条数（有效 id + 歌单类型，跨窗口按 id 去重），
   * **未**按 `excludeIds` 过滤。用来区分两种「一条都没选中」：
   * - `candidateCount=0`：上游回的是空列表 / 全是无效条目（限流常回 200 + `[]`），
   *   这一批属于「没取到数据」，应保留旧列表并在同一窗口重试；
   * - `exhausted`：真的拿到过候选，只是全被跨批历史排除（旧面孔），才是「轮完一轮」。
   */
  candidateCount: number
  /**
   * 成功但**一条可用候选都没有**的窗口数（上游回 `[]` / 全被空 id、非歌单过滤）。
   *
   * 为什么光看 candidateCount 不够：「1 个窗口回了老数据 + 2 个窗口空响应」时
   * candidateCount>0、所有请求也都成功，但它显然不能算「轮完一轮」—— 那两个空窗口
   * 只是没拿到数据。所以 exhausted 要求每个成功窗口都真的给过候选。
   */
  emptyWindows: number
  /**
   * 每个尝试窗口都成功、都真的给过可用候选，但候选全被跨批历史排除。
   *
   * ⚠ 它只能证明**本批这 2–3 个窗口**没有新面孔，**不等于整轮都翻完了**：
   * 一轮有 HOT_WINDOW_COUNT（13 分类 × 3 轮 = 39）个窗口，其余窗口完全可能有新歌单。
   * 「是否翻完一轮」必须由调用方按窗口累计（见 useHotPlaylists 的 decideHotBatch /
   * exhaustedWindows），否则会在 3 个窗口时就误报「轮完一轮」并收缩去重历史。
   *
   * 三种「这一批没有内容」必须分开：
   * - `exhausted=true` → 真的没新东西了，应提示「已轮完一轮」并推进游标；
   * - 有窗口失败（`okWindows < attemptedWindows.length`）→ 网络/上游挂了，
   *   应保留旧列表与去重历史，游标原地重试；
   * - `candidateCount=0` 或 `emptyWindows>0`（窗口都成功）→ 上游空响应/无有效候选，
   *   同样保留旧内容与历史、原地重试；
   * - 三者都不成立 → 正常（哪怕只填到 7 个也算正常，少几张比多发一堆请求好）。
   */
  exhausted: boolean
  /**
   * 真正贡献了**第一条入选内容**的窗口；一个都没选中时为 null。
   *
   * 不能拿调用方传进来的 `startCursor` 当「来源」：主窗口整窗被 `excludeIds` 过滤光、
   * 或者主窗口请求失败而后面某个窗口成功时，内容其实来自后面的窗口。
   * 用 startCursor 会把「摇滚」标在实际来自「民谣」的内容上（见 useHotPlaylists 注释）。
   *
   * 注意它只记录**第一个**贡献窗口，游标语义之外不要拿它做展示 —— 展示用
   * `sourceCategories`（补窗可能跨分类，只写第一个分类就是误标）。
   */
  sourceWindow: HotWindow | null
  /**
   * 实际贡献过内容的窗口分类（按请求顺序、去重）；一个都没选中时为 []。
   *
   * 补窗可能跨分类（主窗口被 excludeIds 滤光后，4 条来自「华语」、6 条来自「民谣」），
   * 只标 sourceWindow 的第一个分类会把民谣内容说成华语 —— 「变化来源」标签必须
   * 以这个集合为准（单个分类照原名，多个分类并列；长度 ≤ HOT_MAX_WINDOWS_PER_LOAD）。
   */
  sourceCategories: string[]
}

/**
 * 从一个窗口开始向后填充，直到凑够 limit 或候选窗口用完。
 *
 * 为什么要这个函数而不是在页面里写 `for`：
 * - 「换一批到底发了几个请求」是验收项（用户能感知的是等待时间），必须可测；
 * - 「窗口里的内容全是已展示过的」与「窗口请求失败」是两种完全不同的情况，
 *   前者说明上游/缓存稳定（该继续往下一窗口看），后者什么都不说明
 *   （不该因为第一批失败就判定整轮没内容）。这里把它们分开记在
 *   windows（成功）/ attemptedWindows（全部）/ candidateCount / emptyWindows 里，
 *   调用方据此才能把「请求失败」「上游空响应」「全是旧面孔」三种结局区分开。
 * - 任何一个窗口抛错都不影响其它窗口：热门区是可选内容，不该把首页拖下水。
 */
export async function fillHotPlaylists<T extends HotPlaylistLike>(
  options: FillHotPlaylistsOptions<T>,
): Promise<FillHotPlaylistsResult<T>> {
  const requested = Number(options.limit)
  const limit =
    Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_HOT_LIMIT
  const wantedMax = Number(options.maxWindows)
  const maxWindows =
    Number.isFinite(wantedMax) && wantedMax > 0
      ? Math.floor(wantedMax)
      : HOT_MAX_WINDOWS_PER_LOAD

  const candidates = hotWindowCandidates(options.startCursor, limit, maxWindows)
  /** 已经收集到的原始 id（注意：请传 **id**，不是 `id:` key） */
  const collectedIds = new Set<string>()
  /** 成功窗口里出现过的可用候选 key（去重后才算「上游到底有没有货」） */
  const candidateKeys = new Set<string>()
  /** 成功、但一条可用候选都没有的窗口数（空响应 / 全是无效条目） */
  let emptyWindows = 0
  const items: T[] = []
  /** 只收成功窗口 —— 游标推进依赖它（失败窗口不能算「已消费」） */
  const windows: HotWindow[] = []
  /** 全部发过请求的窗口（含失败），供诊断 */
  const attemptedWindows: HotWindow[] = []
  let okWindows = 0
  /** 贡献了第一条入选内容的窗口（游标推进兜底用；展示以 sourceCategories 为准） */
  let sourceWindow: HotWindow | null = null
  /** 实际贡献过内容的分类（按请求顺序去重） */
  const sourceCategories: string[] = []

  for (const window of candidates) {
    if (items.length >= limit) break
    // 先记「问过」再发请求：失败也要留在诊断信息里，但不进 windows
    attemptedWindows.push(window)
    let rows: readonly T[]
    try {
      rows = await options.fetchWindow(window)
    } catch {
      // 单个窗口失败只说明这一个窗口没拿到：继续看下一个
      continue
    }
    okWindows += 1
    windows.push(window)
    // 记录「上游到底给了多少可用候选」（excludeIds 之前）——
    // 一条候选都没有 ≠「全是老面孔」，前者是没取到数据，不能报「已轮完一轮」
    let usableInWindow = 0
    for (const row of rows) {
      if (!isUsableHotPlaylist(row)) continue
      candidateKeys.add(hotPlaylistKey(row))
      usableInWindow += 1
    }
    if (usableInWindow === 0) emptyWindows += 1
    const remaining = limit - items.length
    const picked = selectHotPlaylists(rows, {
      limit: remaining,
      excludeIds: [...(options.excludeIds ?? []), ...collectedIds],
    })
    if (picked.length > 0) {
      if (sourceWindow == null) sourceWindow = window
      if (!sourceCategories.includes(window.category)) sourceCategories.push(window.category)
    }
    for (const item of picked) {
      const id = String(item.id ?? '').trim()
      if (id === '') continue
      collectedIds.add(id)
      items.push(item)
    }
  }

  return {
    items,
    windows,
    attemptedWindows,
    okWindows,
    candidateCount: candidateKeys.size,
    emptyWindows,
    // 只有「每个窗口都成功、都真的给过候选，却一个都没选中」才是轮完一轮。
    // 空响应 / 网络失败 / 部分窗口空都只说明这一批没拿到数据 —— 当成用尽会误提示、
    // 还会把跨批去重历史收缩掉（恢复后旧歌单被重新摆上首页）。
    exhausted:
      items.length === 0 &&
      candidateKeys.size > 0 &&
      emptyWindows === 0 &&
      okWindows === attemptedWindows.length,
    sourceWindow,
    sourceCategories,
  }
}

/**
 * 跨批去重历史（shownIds）的有界合并。
 *
 * 为什么需要：shownIds 只增不减的话，走完一轮（HOT_WINDOW_COUNT × 每批条数个 id）
 * 之后每个窗口都只会返回老面孔，`exhausted` 会把「换一批」永久锁死到重启为止。
 * 移动端靠 exhausted 时把历史收缩成当前屏来解；桌面端在此基础上再给历史一个
 * 硬上界（默认 = 一整轮窗口 × 每批条数）—— 双保险，且内存占用有界。
 *
 * 口径：
 * - 先按「旧的在前、新的在后」去重，空/空白 id 不收录；
 * - 超过 cap 时从**最旧**的开始丢；
 * - **绝不丢当前屏的 id**（哪怕它在历史里出现得很早）—— 丢掉它等于下一批
 *   可能把用户正在看的歌单再摆一遍。当前屏数量超过 cap 的病态输入下，
 *   「不丢当前屏」优先于「不超 cap」。
 */
export function boundShownIds(
  previous: Iterable<string>,
  currentScreen: Iterable<string>,
  cap: number = HOT_WINDOW_COUNT * DEFAULT_HOT_LIMIT,
): string[] {
  const safeCap =
    Number.isFinite(cap) && cap > 0
      ? Math.floor(cap)
      : HOT_WINDOW_COUNT * DEFAULT_HOT_LIMIT
  const current: string[] = []
  for (const id of currentScreen) {
    const text = String(id ?? '').trim()
    if (text !== '' && !current.includes(text)) current.push(text)
  }
  const mustKeep = new Set(current)

  const merged: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    const text = String(raw ?? '').trim()
    if (text === '' || seen.has(text)) return
    seen.add(text)
    merged.push(text)
  }
  for (const id of previous) push(id)
  for (const id of current) push(id)

  if (merged.length <= safeCap) return merged

  let toDrop = merged.length - safeCap
  const result: string[] = []
  for (const id of merged) {
    if (toDrop > 0 && !mustKeep.has(id)) {
      toDrop -= 1
      continue
    }
    result.push(id)
  }
  return result
}

/** 按天变化的兜底游标（同一天相同、隔天变化） */
export function dailyHotCursor(now: number = Date.now()): number {
  const value = Number.isFinite(now) ? now : 0
  return normalizeHotCursor(Math.floor(value / MS_PER_DAY))
}

function resolveHotStorage(storage?: KeyValueStorage | null): KeyValueStorage | null {
  if (storage !== undefined) return storage
  try {
    return createDefaultStorage()
  } catch {
    return null
  }
}

function parseStoredCursor(raw: string | null): number | null {
  if (raw == null) return null
  const text = raw.trim()
  if (text === '') return null
  const value = Number.parseInt(text, 10)
  if (!Number.isFinite(value)) return null
  return normalizeHotCursor(value)
}

/**
 * 取出「本次冷启动」要用的窗口游标，并把持久化游标推进一格。
 *
 * 语义：
 * - 有存储 + 有历史值 → 返回 `stored + 1`（回绕），并把 `stored + 1` 写回；
 * - 有存储 + 无历史值（首次安装 / 清过缓存）→ 返回「按天」的游标，
 *   下次启动才会从它继续前进；
 * - 存储不可用或读抛出 → 同样退化成「按天」游标（至少隔天会变）。
 *
 * **调用方必须每个进程只调用一次**（首页 hook 用模块级变量记住结果）：
 * 每次调用都会推进游标，若在组件挂载时调用，切个页面回来内容就变了，
 * 违背「同一次使用里体验稳定」。
 */
export function advanceHotCursor(
  storage?: KeyValueStorage | null,
  now: number = Date.now(),
): number {
  const fallback = dailyHotCursor(now)
  const store = resolveHotStorage(storage)
  if (store == null) return fallback

  let raw: string | null = null
  try {
    raw = store.getString(HOT_CURSOR_STORAGE_KEY)
  } catch {
    return fallback
  }

  const stored = parseStoredCursor(raw)
  const next = stored == null ? fallback : nextHotCursor(stored)
  try {
    // 只在真的需要时写：首次退化成按天游标时也记下来，下次从这里前进
    store.setString(HOT_CURSOR_STORAGE_KEY, String(next))
  } catch {
    /* 写失败只影响下次启动的变化性，不影响本次展示 */
  }
  return next
}

/** 读取当前持久化游标（不推进），供测试与调试用；没有值时返回 null */
export function peekHotCursor(
  storage?: KeyValueStorage | null,
): number | null {
  const store = resolveHotStorage(storage)
  if (store == null) return null
  try {
    return parseStoredCursor(store.getString(HOT_CURSOR_STORAGE_KEY))
  } catch {
    return null
  }
}
