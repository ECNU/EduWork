import z from '@deepseek-ai/schemastery'

import { generateIdentity } from './channel/crypto.js'
import { decideEndpoint } from './channel/operations.js'
import { KernelHost, kernelDispatch } from './relay/host.js'
import { createHostTunnel } from './relay/tunnel.js'
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

/**
 * Where this Host dials out, and who it claims to be when it gets there.
 *
 * `hostId` is the name devices ask for; the identity key behind it is generated
 * and kept separately, so this is a label and not a secret. Both must be set
 * together — a relay URL without an id registers nothing, and an id without a URL
 * has nowhere to register.
 */
const RelaySchema = z.object({
  url: z.string().default(''),
  hostId: z.string().default(''),
})

export const SettingsSchema = z.object({
  // Off until the operator turns it on. Remote reach must never appear as a
  // side effect of an upgrade.
  enabled: z.boolean().default(false),
  devices: z.array(z.any()).default([]),
  relay: RelaySchema.default({ url: '', hostId: '' }),
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
    relay: {
      url: typeof raw.relay?.url === 'string' ? raw.relay.url : '',
      hostId: typeof raw.relay?.hostId === 'string' ? raw.relay.hostId : '',
    },
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

  /** Where to dial out, and the host id to claim. Both empty means "nowhere". */
  get relay() {
    // Defaulted rather than trusted: settings written by an earlier version have
    // no relay key at all, and destructuring that would throw inside the effect
    // that decides whether to dial — turning an absent setting into a crash.
    return this.#settings().relay ?? { url: '', hostId: '' }
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

  startTunnel(ctx, registry)

  return registry
}

/**
 * Dial out to the configured relay, if there is one and the operator asked for it.
 *
 * Three things have to be true before a single byte leaves this machine: remote
 * access is enabled, a relay URL and host id are set, and the kernel exposes a
 * connection to carry the calls. Any one of them missing means nothing happens —
 * and in particular this must never fall back to starting a listener, because
 * "remote reach appeared after an upgrade" is the outcome the whole design is
 * arranged to prevent.
 *
 * The identity is generated here and handed to the tunnel; the private half never
 * leaves this process and is never written to settings, which hold a device
 * registry and nothing worth stealing.
 */
/**
 * Find the authority the kernel will authenticate this Host as.
 *
 * The kernel's own browser transport builds this as
 * `http://127.0.0.1:${webServer.port}` — `dsh-desktop-host` does exactly that before
 * handing the URL to the desktop shell — and the session cookie it issues is bound
 * to that exact authority string, because the cookie *name* is a hash of it.
 *
 * An earlier version read `webServer.url` and `webServer.address()`. Neither exists:
 * the service exposes `{ port, host, register, registerUpgrade, registerFallback,
 * renderIndex, collectIndexInjections }`. The result was an undefined authority, a
 * tunnel that never started, and no error anywhere — the plugin simply did nothing
 * while every unit test passed, because the tests supplied the shape the code
 * expected rather than the shape the kernel has.
 *
 * @returns the authority, or undefined when the kernel has not begun listening.
 */
export function authorityFrom(webServer) {
  // Tolerated because the kernel is free to grow a richer accessor, and a deployment
  // that has one should not have to wait for this file to be taught about it.
  const provided = webServer?.url ?? webServer?.address?.()
  if (typeof provided === 'string' && provided !== '') return new URL(provided).host
  if (provided !== undefined && typeof provided === 'object' && provided !== null) {
    const { address, port } = provided
    if (typeof port === 'number') return `${String(address ?? '127.0.0.1')}:${String(port)}`
  }
  const port = webServer?.port
  if (typeof port !== 'number' || port <= 0) return undefined
  // `webServer.host` is the configured bind literal, which can be `0.0.0.0`. The
  // kernel's transport is on loopback — `docs/protocol.md` and the plugin's own
  // invariants both require the Host to keep binding `127.0.0.1` — so a wildcard
  // bind is translated to the loopback address the cookie was minted for rather
  // than reused verbatim, which would name an authority the kernel never sees.
  const configured = webServer?.host
  const host = configured === '0.0.0.0' || configured === '::' || configured === undefined
    ? '127.0.0.1'
    : configured
  return `${host}:${String(port)}`
}

function startTunnel(ctx, registry) {
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(() => {
      // Read live, inside the effect. Checking these before registering it would
      // mean the setting only takes effect after a restart — and an operator who
      // turns remote access on and sees nothing happen will conclude it is broken.
      if (!registry.enabled) return undefined
      const { url, hostId } = registry.relay
      if (url === '' || hostId === '') return undefined

      let tunnel
      let kernelHost
      let cancelled = false

      const report = (line) => {
        if (connectionCtx.logger?.warn !== undefined) connectionCtx.logger.warn(line)
        else console.warn(line)
      }

      void (async () => {
        // The authority the Host authenticates as. The kernel mounts its browser
        // transport on the loopback interface and binds the cookie it hands out to
        // this exact string, so it is read from the kernel rather than assembled
        // here — an extra or missing detail produces a 401 three layers down with
        // nothing to point at.
        const authority = authorityFrom(connectionCtx.webServer)
        if (cancelled) return
        if (authority === undefined) {
          // Not fatal and not always wrong — the effect can run before the web
          // server has bound its port — but it must not be silent, because the
          // other cause is a kernel whose shape has changed.
          report('remote-access: the web server has no port yet; not dialing out')
          return
        }
        kernelHost = new KernelHost({ connection: connectionCtx.connection, authority })
        const identity = await generateIdentity()
        if (cancelled) return
        tunnel = await createHostTunnel({
          url,
          hostId,
          identity,
          devices: liveDevices(registry),
          decide: decideEndpoint,
          dispatch: kernelDispatch(kernelHost),
          log: (line) => connectionCtx.logger?.info?.(line) ?? console.log(line),
        })
      })().catch((error) => {
        // Without this the promise rejects into the void: a wrong relay URL, a
        // refused handshake or a relay that rejects this host id all look exactly
        // like remote access being switched off.
        if (cancelled) return
        report(`remote-access: could not reach the relay at ${url}: ${error instanceof Error ? error.message : String(error)}`)
      })

      return () => {
        cancelled = true
        tunnel?.stop()
        // The cookie is a real credential; dropping it on teardown means a Host
        // that stops serving does not keep one lying around in memory.
        kernelHost?.forgetCookie()
      }
    }, 'remote-access: dial out to the relay')
  })
}

/**
 * The device lookup the handshake uses, read live from settings.
 *
 * A snapshot would mean a device revoked while it is connecting is still admitted
 * by the handshake already in progress. Reading through on every lookup is what
 * makes revocation take effect at the next question rather than at the next
 * restart.
 */
function liveDevices(registry) {
  return {
    get(deviceId) {
      return registry.find(deviceId)
    },
  }
}
