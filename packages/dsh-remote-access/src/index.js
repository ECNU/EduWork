import { join } from 'node:path'

import z from '@deepseek-ai/schemastery'

import { adminUrl, registerAdminSurface } from './admin.js'
import { randomToken } from './channel/crypto.js'
import { decideEndpoint } from './channel/operations.js'
import { LiveConnections } from './connections.js'
import { loadHostIdentity } from './host-identity.js'
import { probe } from './probe.js'
import { KernelHost, kernelDispatch } from './relay/host.js'
import { createHostTunnel } from './relay/tunnel.js'
import { exportWebSnapshot } from './web-snapshot.js'
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

/**
 * Module-level markers.
 *
 * These exist because a boot that produced no trace was ambiguous: nothing
 * distinguished "the kernel never imported this module" from "it imported and
 * `apply` was never called" from "`apply` ran and could not write". Those three have
 * completely different causes — a loader that skipped the row, a compatibility
 * preflight that disabled it, and an unwritable directory — and only the last is a
 * problem with the trace itself.
 *
 * Three markers, at three points, in one line each. `module evaluated` is here;
 * `apply called` is the first line of `apply`; `after settings register` is after the
 * only step that can throw before the first marker inside `apply` would have been
 * reached. Where the sequence stops is the diagnosis.
 */
try {
  probe('module evaluated', `inject=${JSON.stringify(inject)} pid=${String(process.pid)}`)
} catch (error) {
  // A trace that can stop the module from loading has inverted its own purpose. This
  // is belt-and-braces: `probe` already swallows everything, and the module still must
  // not be the thing that breaks the boot.
  void error
}

export { DEFAULT_AGENT_SURFACE, DEVICE_STATUS }

/** Settings namespace that durably holds the registry. */
export const SETTINGS_NAMESPACE = 'eduwork-remote-access'

/**
 * The spellings this plugin's settings row may be filed under, best first.
 *
 * The identifier is not the plugin name: `scripts/assemble-017-source-product.mjs`
 * writes each distribution plugin's row with the *entry id* from
 * `config/distributions/generic.json`, and the settings form keys rows by that id.
 * The profile in front of a running application is not always this repository's, so
 * the id it was assembled under is not something this file can assume — it is
 * something it has to look for.
 *
 * Ordered so the intended name is tried first and the shorter legacy spelling second,
 * and read as a list rather than a fallback chain so a third spelling is one entry
 * rather than another branch.
 */
export const SETTINGS_NAMESPACE_CANDIDATES = Object.freeze([
  SETTINGS_NAMESPACE,
  'remote-access',
])

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

/**
 * The editable fields, wrapped for the settings form.
 *
 * `typeof z.string().volatile` — note the call — and not `typeof z.string.volatile`.
 * The two differ by one parenthesis and by the entire feature: `typeof` binds tighter
 * than `===`, so the second form parses as `typeof (z.string.volatile === 'function')`,
 * which is the string `'boolean'`, which is never `'function'`. `Config` was therefore
 * `undefined` on every boot, and an undefined `Config` is not a degraded settings
 * panel — it is no panel at all, silently, while everything else about the plugin
 * looks correct.
 *
 * The `? :` remains rather than being replaced by a plain call because on a host whose
 * schemastery predates `volatile()` the correct behaviour is to expose no editable
 * fields, not to fail the import.
 */
export const Config = typeof z.string().volatile === 'function'
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
  /**
   * The namespace the row was actually found under.
   *
   * The profile entry id is the settings namespace — `remote-access` in this
   * deployment — while the plugin's own name is `eduwork-remote-access`. Reads try
   * both; a write has to use the one that exists, or it fails on a namespace with
   * no row. Remembering the successful spelling is what keeps `upsert` and
   * `revoke` from writing somewhere the host cannot find.
   */
  #namespace

  constructor({ ctx, now }) {
    this.#ctx = ctx
    this.#now = now ?? (() => new Date().toISOString())
  }

  /**
   * Current settings, tolerating hosts that only expose `describe()`.
   *
   * ## Why the namespace is looked up rather than assumed
   *
   * This plugin's settings row is identified by the profile entry id, and the plugin
   * name is not that id: the profile writes `id: remote-access`, while this file
   * carried a longer namespace of its own. The settings service keys rows by the id,
   * so looking up the wrong spelling finds nothing, `baseSettings` falls back to its
   * defaults, and the registry reports `enabled: false` while the operator's file
   * plainly says `true` — a plugin that is switched on reading itself as switched off.
   *
   * Both spellings are tried, in order, against whatever the service actually serves.
   * The first that resolves wins and is remembered for writes; if neither does, the
   * defaults apply and nothing is dialled, which is the safe direction to fail in.
   */
  #settings() {
    const { settings } = this.#ctx
    for (const namespace of SETTINGS_NAMESPACE_CANDIDATES) {
      const value = typeof settings.get === 'function'
        ? settings.get(namespace)
        : settings.describe().find(row => row.ns === namespace)?.value
      if (value !== undefined && value !== null) {
        this.#namespace = namespace
        return baseSettings(value)
      }
    }
    return baseSettings({})
  }

  /** The row this plugin writes through; see {@link DeviceRegistry.#namespace}. */
  #settingsNamespace() {
    this.#settings()
    return this.#namespace ?? SETTINGS_NAMESPACE
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
    await this.#ctx.settings.update(this.#settingsNamespace(), { devices: registry.devices })
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
  // The first line of `apply`, deliberately before anything that can throw. Together
  // with the module-level marker this separates "not imported" from "imported but not
  // applied" from "applied and then failed".
  probe('apply called', `rawConfigKeys=${JSON.stringify(Object.keys(rawConfig))}`)

  ctx.inject(['settings'], (settingsCtx) => {
    if (typeof settingsCtx.settings.register !== 'function') {
      probe('settings register skipped', 'the service exposes no register()')
      return
    }
    settingsCtx.settings.register(SETTINGS_NAMESPACE, SettingsSchema, {
      base: baseSettings(rawConfig),
    })
    probe('settings registered', SETTINGS_NAMESPACE)
  })

  const registry = new DeviceRegistry({ ctx })
  // One registry across the whole plugin lifetime: a device session that outlives a
  // settings read must still be closable when the operator revokes it.
  const connections = new LiveConnections()
  ctx.provide('remoteAccess', registry)
  probe('registry provided', `enabled=${String(registry.enabled)} relayUrl=${JSON.stringify(registry.relay.url)} hostId=${JSON.stringify(registry.relay.hostId)}`)

  // Which spellings the settings service actually serves, printed once per boot. The
  // registry looks the row up by id, and the id is assembled from the distribution
  // rather than being the plugin name — so this line is what turns the lookup from a
  // guess into something a trace can confirm.
  try {
    const served = typeof ctx.settings?.describe === 'function'
      ? ctx.settings.describe().map(row => row.ns)
      : undefined
    if (served !== undefined) {
      probe('settings rows', `ours=${String(served.some(ns => SETTINGS_NAMESPACE_CANDIDATES.includes(ns)))} all=${JSON.stringify(served)}`)
    }
  } catch (error) {
    probe('settings rows', `describe threw: ${String(error?.message ?? error)}`)
  }

  startTunnel(ctx, registry, connections)

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

function startTunnel(ctx, registry, connections) {
  // `typertGateway` carries the two entry points a remote carrier needs, and it is a
  // declared service key rather than an internal — `dsh-tool-cordis`'s catalog lists
  // `key: 'typertGateway'` with `wireStream` on it. Injecting both means the effect
  // only runs where there is something to dispatch to.
  //
  // `webServer` is in the list because Cordis refuses to read a service the context
  // did not declare: `connectionCtx.webServer` throws `cannot get property "webServer"
  // without inject` rather than returning `undefined`. That is what stopped this
  // tunnel on three consecutive boots, and it was invisible from the outside — the
  // plugin loaded, registered its settings row, passed both of its guards and then
  // died on the line that reads the port, with the failure only visible in a trace
  // this plugin wrote itself.
  ctx.inject(['connection', 'typertGateway', 'webServer'], (connectionCtx) => {
    connectionCtx.effect(() => {
      // Read live, inside the effect. Checking these before registering it would
      // mean the setting only takes effect after a restart — and an operator who
      // turns remote access on and sees nothing happen will conclude it is broken.
      probe('effect ran', `enabled=${String(registry.enabled)} url=${JSON.stringify(registry.relay.url)} hostId=${JSON.stringify(registry.relay.hostId)}`)
      if (!registry.enabled) {
        probe('not dialing', 'remote access is disabled')
        return undefined
      }
      const { url, hostId } = registry.relay
      if (url === '' || hostId === '') {
        probe('not dialing', 'relay url and host id must both be set')
        return undefined
      }

      let tunnel
      let kernelHost
      let cancelled = false
      let disposeAdmin = () => {}

      const report = (line) => {
        if (connectionCtx.logger?.warn !== undefined) connectionCtx.logger.warn(line)
        else console.warn(line)
      }

      const announce = (line) => {
        if (connectionCtx.logger?.info !== undefined) connectionCtx.logger.info(line)
        else console.log(line)
      }

      // The operator's surface: list, confirm, revoke. Served on the kernel's existing
      // loopback web server rather than a port of our own. The URL contains a per-boot
      // token and is printed once below — a page nobody can find is the same as no page.
      const adminToken = randomToken()
      let adminRegistered = false
      try {
        disposeAdmin = registerAdminSurface({
          webServer: connectionCtx.webServer,
          token: adminToken,
          registry,
          connections,
          // The remote browser needs the Host's rendered shell, not just the static
          // dist: the index injections and the client bundles are Host-owned. Taking
          // the snapshot here keeps the cookie in this process, where it belongs.
          exportWeb: async () => {
            const home = process.env.DSH_HOME
            if (typeof home !== 'string' || home === '') {
              throw new Error('web snapshot: DSH_HOME is not set in this process')
            }
            const authority = authorityFrom(connectionCtx.webServer)
            if (authority === undefined) throw new Error('web snapshot: the web server has not bound a port yet')
            return exportWebSnapshot({
              webServer: connectionCtx.webServer,
              connection: connectionCtx.connection,
              authority,
              directory: join(home, 'remote-access', 'web-snapshot'),
              log: (line) => {
                probe('web snapshot', line)
                announce(line)
              },
            })
          },
        })
        adminRegistered = true
      } catch (error) {
        report(`remote-access: the device page could not be registered: ${error instanceof Error ? error.message : String(error)}`)
      }

      /** Sleep, but give up early when the effect has been torn down. */
      const pause = (ms) => new Promise((resolve) => {
        const timer = setTimeout(resolve, ms)
        timer.unref?.()
      })

      /**
       * Wait for a value the effect ran too early to see.
       *
       * Both of the things this waits for appear *after* `connection`, and the binding
       * is a value read at this moment rather than a live reference that fills in
       * later:
       *
       *   - `typertGateway` injects `typert`, so it mounts once the registry does. On a
       *     real boot the effect read it fully empty — `wireStream`, `dispatchRpc` and
       *     `invoke` all `undefined` — and then dialled with no stream entry point at
       *     all, which is a tunnel that serves unary calls and silently cannot serve a
       *     single stream.
       *   - `webServer` binds its port asynchronously, which is why the port was still
       *     zero and the tunnel stood down with "no port yet".
       *
       * Neither is an error: both are "not yet". Standing down on the first look is
       * what turned a plugin that was switched on and correctly configured into one
       * that did nothing on every boot.
       */
      const waitFor = async (read, { attempts = 40, intervalMs = 250 } = {}) => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (cancelled) return undefined
          const value = read()
          if (value !== undefined) return value
          await pause(intervalMs)
        }
        return undefined
      }

      void (async () => {
        // The authority the Host authenticates as. The kernel mounts its browser
        // transport on the loopback interface and binds the cookie it hands out to
        // this exact string, so it is read from the kernel rather than assembled
        // here — an extra or missing detail produces a 401 three layers down with
        // nothing to point at.
        const authority = await waitFor(() => authorityFrom(connectionCtx.webServer))
        if (cancelled) return
        if (authority === undefined) {
          // Not fatal and not always wrong — the effect can run before the web
          // server has bound its port — but it must not be silent, because the
          // other cause is a kernel whose shape has changed.
          probe('no authority', 'the web server never reported a port')
          report('remote-access: the web server never reported a port; not dialing out')
          return
        }
        probe('authority', authority)
        if (adminRegistered) {
          // The per-boot token must not be written to a persistent trace. The operator
          // reads the URL once from the host's own log; the trace only records that the
          // page was registered.
          const url = adminUrl(authority, adminToken)
          probe('admin page', 'registered')
          console.log(`remote-access: admin page ${url}`)
          announce(`remote-access: device page ${url}`)
        }

        // Waited for only once the decision to dial is firm, so a disabled or
        // unconfigured plugin does not sit in this loop.
        const gateway = await waitFor(
          () => (typeof connectionCtx.typertGateway?.dispatchRpc === 'function' ? connectionCtx.typertGateway : undefined),
        )
        if (cancelled) return
        probe('gateway service', gateway === undefined
          ? 'never appeared; streams will be unavailable'
          : `wireStream=${typeof gateway.wireStream?.open} dispatchRpc=${typeof gateway.dispatchRpc} invoke=${typeof gateway.invoke}`)

        kernelHost = new KernelHost({ connection: connectionCtx.connection, authority })
        // The relay binds `hostId` to this key on the first registration and refuses
        // a different one forever, and every paired device pins it. A fresh identity
        // per boot would therefore work exactly once. The credential store keeps it;
        // see `src/host-identity.js` for what happens when the host has none.
        const { identity, source } = await loadHostIdentity(connectionCtx.get('credentials'), probe)
        if (source === 'ephemeral') {
          report('remote-access: no credential store is available; this host identity will not survive a restart')
        }
        if (cancelled) return
        probe('dialing', url)
        /**
         * A device that is not paired yet is still allowed to *ask*: its `hello`
         * carries the identity it wants to use, and the operator sees it on the device
         * page. Recording it as pending is not trusting it — the handshake still fails,
         * and nothing about the device is believed until `confirm` on this machine.
         *
         * The cap exists because anyone who learns the host id can reach the relay's
         * peer endpoint; without a limit that is a way to fill the settings row.
         */
        const MAX_PENDING_DEVICES = 16
        const rememberUnknownDevice = async ({ deviceId, publicKey, agreementKey }) => {
          const devices = registry.read().devices
          if (devices.some(device => device.deviceId === deviceId)) return
          if (devices.filter(device => device.status === DEVICE_STATUS.PENDING).length >= MAX_PENDING_DEVICES) {
            probe('pending device', 'ignored: too many unconfirmed devices')
            return
          }
          await registry.upsert({ deviceId, name: '待确认设备', publicKey, agreementKey })
          probe('pending device', deviceId)
        }
        tunnel = await createHostTunnel({
          url,
          hostId,
          identity,
          devices: liveDevices(registry),
          decide: decideEndpoint,
          dispatch: kernelDispatch(kernelHost),
          connections,
          onUnknownDevice: rememberUnknownDevice,
          /**
           * The Gateway's own logical-stream entry point, taken from the service the
           * kernel mounted.
           *
           * This is the in-process carrier the Gateway documents: `wireStream.open`
           * is what its own WebSocket adapter calls, so a stream opened here takes the
           * same path a browser's would without any of the HTTP machinery in between.
           * The fallback refuses the one stream that asked rather than failing the
           * tunnel, because a Host without the gateway can still serve unary calls.
           */
          openStream: typeof gateway?.wireStream?.open === 'function'
            // The channel's `peer` is our device identity for the gate, not the
            // Gateway's Connection peer. `wireStream.open` resolves the endpoint
            // against that peer's claims, and a device-shaped peer made every real
            // stream fail while unary calls kept working. The device is the
            // operator's paired terminal and our gate already decided the endpoint;
            // let the in-process carrier speak for the operator.
            ? (endpoint, payload, uplink, _peer, signal) => gateway.wireStream.open(endpoint, payload, uplink, undefined, signal)
              .catch((error) => {
                probe('stream error', `${endpoint}: ${error?.message ?? String(error)}`)
                throw error
              })
            : undefined,
          log: (line) => {
            probe('tunnel', line)
            connectionCtx.logger?.info?.(line) ?? console.log(line)
          },
        })
        probe('tunnel returned', `connected=${String(tunnel.connected)}`)
      })().catch((error) => {
        // Without this the promise rejects into the void: a wrong relay URL, a
        // refused handshake, an unreadable stored identity or a relay that rejects
        // this host id all look exactly like remote access being switched off.
        if (cancelled) return
        probe('dial failed', `${error?.name}: ${error?.message}`)
        report(`remote-access: the tunnel to ${url} could not start: ${error instanceof Error ? error.message : String(error)}`)
      })

      return () => {
        cancelled = true
        probe('tearing down', 'effect disposed')
        disposeAdmin()
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
