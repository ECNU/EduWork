/** Single-consumer async queue: items in order, then an end or a failure. */
export class Inbox<T> implements AsyncIterable<T> {
  #items: T[] = []
  #ended = false
  #failed = false
  #failure: unknown
  #wake: (() => void) | undefined

  push(item: T): void {
    if (this.#ended || this.#failed) return
    this.#items.push(item)
    this.#notify()
  }

  end(): void {
    this.#ended = true
    this.#notify()
  }

  /** Fail the consumer at once, dropping queued items. */
  fail(reason: unknown): void {
    if (this.#ended || this.#failed) return
    this.#failed = true
    this.#failure = reason
    this.#items.length = 0
    this.#notify()
  }

  async next(): Promise<IteratorResult<T, undefined>> {
    for (;;) {
      if (this.#failed) throw this.#failure
      if (this.#items.length > 0) return { value: this.#items.shift()!, done: false }
      if (this.#ended) return { value: undefined, done: true }
      await new Promise<void>(resolve => { this.#wake = resolve })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T, undefined> {
    return { next: () => this.next() }
  }

  #notify(): void {
    const wake = this.#wake
    this.#wake = undefined
    wake?.()
  }
}
