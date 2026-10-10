import z from '@deepseek-ai/schemastery'

import {
  DEFAULT_AGENT_SURFACE,
  DEVICE_STATUS,
  confirmDevice,
  emptyRegistry,
  findDevice,
  listDevices,
  normalizeRegistry,
  removeDevice,
  revokeDevice,
  trustedDevices,
  upsertDevice,
} from './registry.js'

export const name = 'remote-access'
export const inject = ['settings']

export { DEFAULT_AGENT_SURFACE, DEVICE_STATUS }

/** Settings namespace that durably holds the registry. */
export const SETTINGS_NAMESPACE = 'eduwork-remote-access'

export const SettingsSchema = z.object({
  // Off until the operator turns it on. Remote reach must never appear as a
  // side effect of an upgrade.
  enabled: z.boolean().default(false),
  devices: z.array(z.any()).default([]),
})

// DSH rc.1 needs the volatile wrapper; older hosts do not have it.
export const Config = typeof z.string.volatile === 'function'
  ? z.object(Object.fromEntries(
      Object.entries(SettingsSchema.dict).map(([key, field]) => [key, field.volatile()]),
    ))
  : undefined

function baseSettings(raw = {}) {
  return {
    enabled: raw.enabled === true,
    devices: normalizeRegistry({ devices: raw.devices ?? [] }).devices,
  }
}

/**
 * Host-owned device registry.
 *
 * The service is thin on purpose: every decision lives in `registry.js`, which is
 * pure and unit-tested. This class only persists the result and hands back what
 * the caller must act on.
 *
 * It is *not* a permission system. Whether a device may reach the Agent is
 * decided here, on the machine running the Agent; a relay's access key only says
 * "this client may use the relay", and is never consulted for device identity.
 */
export class DeviceRegistry {
  #ctx
  #now

  constructor({ ctx, now }) {
    this.#ctx = ctx
    this.#now = now ?? (() => new Date().toISOString())
  }

  /** Current settings, tolerating hosts that only expose `describe()`. */
  #settings() {
    const { settings } = this.#ctx
    const value = typeof settings.get === 'function'
      ? settings.get(SETTINGS_NAMESPACE)
      : settings.describe().find(row => row.ns === SETTINGS_NAMESPACE)?.value
    return baseSettings(value ?? {})
  }

  /** Remote access is opt-in; every entry point checks this first. */
  get enabled() {
    return this.#settings().enabled
  }

  /** The persisted registry, normalized. */
  read() {
    return normalizeRegistry({ devices: this.#settings().devices })
  }

  list() {
    return listDevices(this.read())
  }

  /** Devices that may currently reach the Agent. */
  trusted() {
    return trustedDevices(this.read())
  }

  find(deviceId) {
    return findDevice(this.read(), deviceId)
  }

  async #persist(registry) {
    await this.#ctx.settings.update(SETTINGS_NAMESPACE, { devices: registry.devices })
    return registry
  }

  /**
   * Record a device that has been seen.
   *
   * The status is decided here, not by the caller, and every alternative is
   * wrong. Requiring it means a caller who reads this method as "note that a
   * device showed up" gets a throw. Honouring it means a habitual
   * `status: 'pending'` silently demotes a device the operator already confirmed,
   * on nothing more than it reconnecting — and a `trusted` in the same position
   * would grant access without anyone confirming anything.
   *
   * So: a device new here starts pending, an existing device keeps the status it
   * has, and whatever the caller sent is ignored either way. Status transitions
   * have their own methods — `confirm` into trusted, `revoke` and `remove` out of
   * it — and this is deliberately not one of them.
   */
  async upsert(device) {
    const existing = this.find(device.deviceId)
    // A revoked device id is spent. Recording a fresh sighting would let a caller
    // rewrite the identity behind a credential that was withdrawn, and there is
    // nothing worth recording: this id can never be admitted again.
    if (existing?.status === DEVICE_STATUS.REVOKED) {
      throw new Error(`device "${device.deviceId}" is revoked and cannot be revived; mint a new device id`)
    }
    const { status: _ignored, ...rest } = device
    const status = existing?.status ?? DEVICE_STATUS.PENDING
    // Merge, do not replace. `upsertDevice` swaps the whole record for what it is
    // given, so passing only what the caller sent would drop the fields this
    // method is not being told about — `pairedAt` among them, which is the record
    // of when the device was first admitted.
    const merged = { ...existing, ...rest, status }
    return this.#persist(upsertDevice(this.read(), merged, this.#now()))
  }

  /**
   * Confirm a pending device on this machine.
   *
   * This is the only path into `trusted`. Phase 1 calls it from the local
   * settings panel; a remote caller must never reach it.
   */
  async confirm(deviceId, surfaces) {
    return this.#persist(confirmDevice(this.read(), deviceId, surfaces, this.#now()))
  }

  /**
   * Revoke a device.
   *
   * Returns `{ registry, revoked }`. Persisting is not the whole operation: the
   * caller must also close every live connection `revoked.deviceId` currently
   * holds. Refusing later requests leaves an established stream running.
   */
  async revoke(deviceId) {
    const outcome = revokeDevice(this.read(), deviceId, this.#now())
    await this.#persist(outcome.registry)
    return outcome
  }

  async remove(deviceId) {
    return this.#persist(removeDevice(this.read(), deviceId))
  }
}

export function apply(ctx, rawConfig = {}) {
  ctx.inject(['settings'], (settingsCtx) => {
    if (typeof settingsCtx.settings.register !== 'function') return
    settingsCtx.settings.register(SETTINGS_NAMESPACE, SettingsSchema, {
      base: baseSettings(rawConfig),
    })
  })

  const registry = new DeviceRegistry({ ctx })
  ctx.provide('remoteAccess', registry)
  return registry
}
