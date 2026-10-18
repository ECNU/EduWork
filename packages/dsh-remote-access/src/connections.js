/**
 * Live connection registry.
 *
 * Revocation is not finished by rewriting a record. Upstream states the limit of
 * a request fence plainly — "existing requests continue when a listener refuses
 * subsequent requests" — and an established stream is worse than a request: it
 * keeps delivering events for as long as it stays open, whether or not new
 * requests are refused. So the device record and this registry have to move
 * together, which is why `revokeDevice` returns the revoked record instead of
 * just a new registry.
 *
 * The registry also closes the race that would otherwise make revocation
 * advisory: once a device is sealed, opening a connection for it fails, so a
 * connection that was mid-handshake when the operator pressed revoke loses
 * rather than slips through.
 */

/** Why an open was refused. */
export const OPEN_REFUSED = 'device-revoked'

function fail(message) {
  throw new Error(`remote-access connections: ${message}`)
}

/**
 * Tracks every live connection per device.
 *
 * A "connection" is anything with a `close()` method: a WebSocket, a
 * `ReadableStream` controller, an `AbortController` wrapper. The registry never
 * inspects it further, so it stays testable without a network.
 */
export class LiveConnections {
  #byDevice = new Map()
  #sealed = new Set()

  /**
   * Register a live connection.
   *
   * @returns a handle whose `close()` detaches and closes exactly once.
   * @throws when the device has been sealed by `closeAll`.
   */
  open(deviceId, connection) {
    if (typeof deviceId !== 'string' || deviceId.trim() === '') fail('deviceId must be a non-empty string')
    if (connection === null || typeof connection !== 'object' || typeof connection.close !== 'function') {
      fail('a connection must be an object with a close() method')
    }
    if (this.#sealed.has(deviceId)) {
      const error = new Error(`remote-access connections: device "${deviceId}" is revoked`)
      error.code = OPEN_REFUSED
      throw error
    }
    let live = this.#byDevice.get(deviceId)
    if (live === undefined) {
      live = new Set()
      this.#byDevice.set(deviceId, live)
    }
    const entry = { connection, deviceId, closed: false }
    live.add(entry)
    return {
      deviceId,
      close: () => this.#closeEntry(entry),
      /**
       * Forget the entry without closing its connection.
       *
       * A device that leaves on its own has already closed its side; calling
       * `connection.close()` here would close the transport the Host shares with
       * the relay, dropping every other device with it. Detach is for "this
       * connection ended", close is for "the operator wants it ended".
       */
      detach: () => this.#detachEntry(entry),
    }
  }

  /**
   * Forget a revocation seal for a device the operator re-confirmed after removal.
   * A live revocation never calls this; only an explicit re-pairing does.
   */
  unseal(deviceId) {
    this.#sealed.delete(deviceId)
  }

  #detachEntry(entry) {
    if (entry.closed) return false
    entry.closed = true
    const live = this.#byDevice.get(entry.deviceId)
    live?.delete(entry)
    if (live?.size === 0) this.#byDevice.delete(entry.deviceId)
    return true
  }

  #closeEntry(entry) {
    if (entry.closed) return false
    this.#detachEntry(entry)
    try {
      entry.connection.close()
    } catch {
      // A connection that throws while closing is already going away; one bad
      // socket must not stop the operator's revocation from completing.
    }
    return true
  }

  /**
   * Seal a device and close everything it currently holds.
   *
   * Seal first, then close: a connection attempted during the sweep is refused
   * rather than added to a set that is being drained.
   *
   * @returns how many connections were closed.
   */
  closeAll(deviceId) {
    if (typeof deviceId !== 'string' || deviceId.trim() === '') fail('deviceId must be a non-empty string')
    this.#sealed.add(deviceId)
    const live = this.#byDevice.get(deviceId)
    if (live === undefined) return 0
    let closed = 0
    for (const entry of [...live]) {
      if (this.#closeEntry(entry)) closed += 1
    }
    return closed
  }

  /** Whether the device has been sealed by a revocation. */
  isSealed(deviceId) {
    return this.#sealed.has(deviceId)
  }

  /** Live connection count for one device. */
  count(deviceId) {
    return this.#byDevice.get(deviceId)?.size ?? 0
  }

  /** Live connection count across all devices. */
  total() {
    let total = 0
    for (const live of this.#byDevice.values()) total += live.size
    return total
  }

  /** Device ids that currently hold at least one connection, sorted. */
  devices() {
    return [...this.#byDevice.keys()].sort()
  }

  /** Close everything. Used when the plugin unloads. */
  closeAllDevices() {
    let closed = 0
    for (const deviceId of [...this.#byDevice.keys()]) closed += this.closeAll(deviceId)
    return closed
  }
}
