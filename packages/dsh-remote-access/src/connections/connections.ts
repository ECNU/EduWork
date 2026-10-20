/**
 * Every open remote connection, grouped by device. Each connection owns one
 * DSH Peer. Closing a connection — by either side, by revocation, or because
 * remote access stops — aborts its exchanges and disposes its Peer, so nothing
 * it started can reach another connection.
 */
import type { Channel } from '../protocol/channel.ts'
import { Close } from '../protocol/close-codes.ts'
import { serveTunnel } from '../protocol/tunnel.ts'
import type { HostAdapter } from '../host/adapter.ts'
import { remoteHandler } from './handler.ts'

export class Connections {
  readonly #adapter: HostAdapter
  readonly #warn: (message: string) => void
  readonly #byDevice = new Map<string, Set<Channel>>()
  readonly #refused = new Set<string>()

  constructor(adapter: HostAdapter, warn: (message: string) => void) {
    this.#adapter = adapter
    this.#warn = warn
  }

  /** Serve one admitted device until its channel closes. */
  async serve(channel: Channel, deviceKey: string): Promise<void> {
    const channels = this.#byDevice.get(deviceKey) ?? new Set()
    this.#byDevice.set(deviceKey, channels.add(channel))
    const peer = this.#adapter.createPeer()
    try {
      await serveTunnel(channel, remoteHandler(this.#adapter, peer, name => {
        if (this.#refused.has(name)) return
        this.#refused.add(name)
        this.#warn(`refused ${name} for remote devices`)
      }))
    } finally {
      channels.delete(channel)
      if (channels.size === 0) this.#byDevice.delete(deviceKey)
      await peer.dispose()
    }
  }

  count(deviceKey: string): number {
    return this.#byDevice.get(deviceKey)?.size ?? 0
  }

  /** Tell each of the device's connections it was revoked, then close them. */
  revoke(deviceKey: string): void {
    for (const channel of this.#byDevice.get(deviceKey) ?? []) {
      channel.send({ t: 'revoked' })
      channel.close(Close.forbidden, 'revoked')
    }
  }
}
