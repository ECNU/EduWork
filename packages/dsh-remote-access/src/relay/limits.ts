/** At most `perMinute` events per key in any minute, refilling evenly: one bucket per key, dropped once full again. */
export class RateLimit {
  readonly #buckets = new Map<string, { tokens: number; at: number }>()
  readonly #perMinute: number
  readonly #now: () => number

  constructor(perMinute: number, now: () => number = Date.now) {
    this.#perMinute = perMinute
    this.#now = now
  }

  /** Whether `key` has an event left now. */
  allows(key: string): boolean {
    return this.#level(key) >= 1
  }

  /** Count an event for `key`; false, and not counted, when it has none left. */
  take(key: string): boolean {
    const tokens = this.#level(key)
    if (tokens < 1) return false
    this.#buckets.set(key, { tokens: tokens - 1, at: this.#now() })
    return true
  }

  /** Forget keys whose bucket has filled up again. */
  prune(): void {
    for (const key of this.#buckets.keys()) if (this.#level(key) >= this.#perMinute) this.#buckets.delete(key)
  }

  #level(key: string): number {
    const bucket = this.#buckets.get(key)
    if (bucket === undefined) return this.#perMinute
    return Math.min(this.#perMinute, bucket.tokens + (this.#now() - bucket.at) * this.#perMinute / 60_000)
  }
}
