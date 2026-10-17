/**
 * The Host method's uplink: a bounded, single-consumer queue.
 *
 * Single-consumer because `invocation.uplink()` may be taken once per call and a
 * second reader would silently steal items from the first. Bounded because the
 * device can send faster than the method reads, and an unbounded queue turns a slow
 * reader into unbounded memory growth on the Host — one the device controls.
 */

/** A conservative size for the buffered-bytes cap. */
function byteLengthOf(item) {
  if (item === undefined) return 0
  try {
    return JSON.stringify(item)?.length ?? 0
  } catch {
    // A value that cannot be measured is not a reason to accept it without limit;
    // it counts as nothing here and the item limit below still applies through the
    // Gateway's own JSON-safety checks upstream.
    return 0
  }
}

export class UplinkInbox {
  #items = []
  #waiting
  #ended = false
  #failure
  #bytes = 0

  /** Buffered frame bytes this inbox will hold before it fails the stream. */
  static MAX_BYTES = 262_144

  /** How many items are buffered right now. */
  get depth() {
    return this.#items.length
  }

  push(item) {
    if (this.#failure !== undefined) throw this.#failure
    if (this.#ended) throw new Error('api gateway: Remote stream uplink item after end')
    const size = byteLengthOf(item)
    if (this.#bytes + size > UplinkInbox.MAX_BYTES) {
      const error = new Error(
        `api gateway: Remote stream uplink exceeded ${String(UplinkInbox.MAX_BYTES)} buffered bytes`,
      )
      this.fail(error)
      throw error
    }
    this.#bytes += size
    this.#items.push({ value: item })
    this.#wake()
  }

  end() {
    if (this.#failure !== undefined || this.#ended) return
    this.#ended = true
    this.#wake()
  }

  /**
   * Fail the uplink.
   *
   * Recorded even after `end()` or after an earlier failure, because the failure is
   * the more specific fact: a carrier that went away after the client half-closed
   * still means the method's uplink did not complete, and a reader that had already
   * drained the queue and seen `end` would otherwise be told the stream finished
   * cleanly. The first failure wins, so a later one cannot rewrite the reason.
   */
  fail(error) {
    if (this.#failure === undefined) this.#failure = error
    this.#wake()
  }

  #wake() {
    const waiting = this.#waiting
    this.#waiting = undefined
    waiting?.()
  }

  async next() {
    for (;;) {
      if (this.#items.length > 0) {
        const item = this.#items.shift()
        this.#bytes -= byteLengthOf(item.value)
        return item
      }
      if (this.#failure !== undefined) throw this.#failure
      if (this.#ended) return { value: undefined, done: true }
      await new Promise(resolve => { this.#waiting = resolve })
    }
  }

  async return() {
    this.#items = []
    this.#ended = true
    this.#wake()
    return { value: undefined, done: true }
  }

  [Symbol.asyncIterator]() {
    return this
  }
}
