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
export const SETTINGS_NAMESPACE = 'chatecnu-remote-access'

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

  /** Record a device that has been seen but not yet confirmed locally. */
  async upsert(device) {
    return this.#persist(upsertDevice(this.read(), device, this.#now()))
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
