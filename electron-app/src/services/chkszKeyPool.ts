/**
 * ChKSz API Key 池 —— 多条 Key 轮询分摊配额，单条失效时自动切换。
 *
 * 设计意图：
 * - 上游按 key 计配额/限流，单 key 在播放高峰容易被限流；池化后每次取 key 都按
 *   轮询指针走下一个，把调用量摊到多条 key 上（分摊配额）。
 * - 某条 key 被拒（401/403/429）时进入冷却期（默认 60s），期间 acquire() 会跳过它，
 *   同一逻辑请求自动换池内其他 key 重试 —— 用户无感，不必手动去设置页换 key。
 * - 全池都在冷却时不做「直接失败」，而是返回冷却最早到期的那条（硬着头皮试一次，
 *   总好过整个音源不可用）。
 * - 纯 TS，不依赖 electron / 浏览器 API；时间源可注入（now），便于单测冷却过期。
 */

/** 单条 key 失效后的默认冷却时长（毫秒）；测试可注入其他值 */
export const CHKSZ_KEY_COOLDOWN_MS = 60_000

/**
 * 去空白、去重、丢空串 —— Key 池与设置存储共用的**唯一**规范化规则。
 * appSettings（settings_chksz_api_keys 的读写/迁移）也 import 这一份，
 * 避免同一条规则两处实现各自漂移。
 */
export function normalizeKeyList(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of values) {
    const key = raw.trim()
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    normalized.push(key)
  }
  return normalized
}

export interface ChkszKeyPoolOptions {
  /** 冷却时长，默认 CHKSZ_KEY_COOLDOWN_MS */
  cooldownMs?: number
  /** 时间源，默认 Date.now（单测注入假时钟） */
  now?: () => number
}

export class ChkszKeyPool {
  private keys: string[] = []
  /** 轮询指针：下一次 acquire() 优先从这个下标开始找可用 key */
  private cursor = 0
  /** key → 冷却结束时间戳；不在表里（或已过期）即视为可用 */
  private readonly cooldownUntil = new Map<string, number>()
  private readonly cooldownMs: number
  private readonly now: () => number

  constructor(options: ChkszKeyPoolOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? CHKSZ_KEY_COOLDOWN_MS
    this.now = options.now ?? Date.now
  }

  get size(): number {
    return this.keys.length
  }

  /**
   * 整体替换 key 列表：trim、去空、去重（共用 normalizeKeyList）。
   *
   * **只有列表内容真的变了才重置轮询指针**：runtime 订阅 AppSettings，任何设置变更
   * （主题、歌词字号…）都会触发 setKeys，无条件重置会让轮询永远从第一条开始，
   * 池化分摊退化成单 key。列表未变时保留当前指针，轮询继续往下走。
   * 池内已不存在的 key 的冷却记录一并清掉，避免反复增删留下垃圾。
   */
  setKeys(values: readonly string[]): void {
    const next = normalizeKeyList(values)
    const changed =
      next.length !== this.keys.length || next.some((key, i) => key !== this.keys[i])
    this.keys = next
    if (changed) this.cursor = 0
    const present = new Set(next)
    for (const key of [...this.cooldownUntil.keys()]) {
      if (!present.has(key)) this.cooldownUntil.delete(key)
    }
  }

  /**
   * 轮询取一个「不在冷却期」的 key；全部在冷却期时返回冷却最早到期的那个；
   * 空池返回 null。
   */
  acquire(): string | null {
    const count = this.keys.length
    if (count === 0) return null

    const now = this.now()
    let fallback: string | null = null
    let fallbackUntil = Number.POSITIVE_INFINITY

    for (let offset = 0; offset < count; offset += 1) {
      const index = (this.cursor + offset) % count
      const key = this.keys[index]
      if (key == null) continue
      const until = this.cooldownUntil.get(key) ?? 0
      if (until <= now) {
        this.cursor = (index + 1) % count
        return key
      }
      if (until < fallbackUntil) {
        fallbackUntil = until
        fallback = key
      }
    }

    // 全池冷却中：用最早到期的那条，至少给调用方一次机会
    return fallback
  }

  /** 标记某条 key 失效（401/403/429）→ 进入冷却期 */
  reportFailure(key: string): void {
    const normalized = key.trim()
    if (normalized === '') return
    this.cooldownUntil.set(normalized, this.now() + this.cooldownMs)
  }

  /** 标记某条 key 恢复可用 → 清除冷却标记 */
  reportSuccess(key: string): void {
    this.cooldownUntil.delete(key.trim())
  }
}
