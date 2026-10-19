/**
 * Local device registry: the durable list of devices allowed to reach this Host.
 *
 * Two properties are deliberate and must not be relaxed:
 *
 * 1. The registry is Host-owned. A device reaches `trusted` only after a human
 *    confirms it on the machine running the Agent. A relay never asserts trust;
 *    a relay access key authorizes *relay use*, not device identity, and is
 *    therefore not represented here at all.
 * 2. Host-management stays closed. `surfaces.host` defaults to empty so that
 *    "this device may talk to the Agent" never implies "this device may change
 *    who is allowed to connect".
 *
 * This module is pure: no I/O, no clock, no randomness. Callers pass the current
 * time in, which is what makes the pairing and revocation semantics testable.
 */

/** Bumped only on an incompatible on-disk shape change. */
export const REGISTRY_VERSION = 1

/**
 * Device lifecycle. A newly paired device is `pending` — it can do nothing until
 * the local machine confirms it. `revoked` is terminal for that device id.
 */
export const DEVICE_STATUS = Object.freeze({
  PENDING: 'pending',
  TRUSTED: 'trusted',
  REVOKED: 'revoked',
})

/** The two operation surfaces. */
export const OPERATION_SURFACES = Object.freeze(['agent', 'host'])

/**
 * What a trusted device may do to the Agent by default.
 *
 * This is an allow-list: an endpoint absent here is unreachable. Withholding a
 * credential does not make a device trustworthy, but granting one that is not
 * needed does make a compromise worse — so the list stays as small as the
 * phase-1 acceptance items require.
 */
export const DEFAULT_AGENT_SURFACE = Object.freeze([
  'session:create',
  'session:list',
  'session:read',
  'session:prompt',
  'session:cancel',
  'workspace:list',
  'workspace:read',
  'artifact:read',
  'artifact:download',
  'settings:read',
])

/**
 * The narrow host surface a confirmed remote device gets by default.
 *
 * This is what makes the in-app workspace browser usable from a remote terminal:
 * browsing the host's directories and registering the chosen folder. `gate.js`
 * keeps a code-level allowlist over the host surface, so this default cannot be
 * widened by editing a device record — only these two operations are reachable.
 */
export const DEFAULT_HOST_SURFACE = Object.freeze([
  'directory:list',
  'workspace:create',
])

const STATUS_VALUES = new Set(Object.values(DEVICE_STATUS))

function fail(message) {
  throw new Error(`remote-access registry: ${message}`)
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} must be a non-empty string`)
  return value.trim()
}

function optionalText(value, field) {
  if (value === undefined || value === null) return undefined
  return requireText(value, field)
}

function optionalTimestamp(value, field) {
  if (value === undefined || value === null) return undefined
  const text = requireText(value, field)
  if (Number.isNaN(Date.parse(text))) fail(`${field} must be an ISO timestamp`)
  return text
}

function normalizeSurfaceList(raw, surface) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) fail(`surfaces.${surface} must be an array`)
  const seen = new Set()
  for (const entry of raw) {
    const scope = requireText(entry, `surfaces.${surface}[]`)
    if (seen.has(scope)) fail(`surfaces.${surface} repeats "${scope}"`)
    seen.add(scope)
  }
  return [...seen].sort()
}

/**
 * Normalize one device record, rejecting anything that cannot be trusted later.
 *
 * A record without a public key is not a device: reconnecting proves identity by
 * signing a challenge, and there is nothing to verify against without the key.
 */
export function normalizeDevice(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('a device must be an object')
  const status = requireText(raw.status, 'status')
  if (!STATUS_VALUES.has(status)) fail(`unknown status "${status}"`)
  const surfaces = raw.surfaces ?? {}
  if (surfaces === null || typeof surfaces !== 'object' || Array.isArray(surfaces)) {
    fail('surfaces must be an object')
  }
  for (const key of Object.keys(surfaces)) {
    if (!OPERATION_SURFACES.includes(key)) fail(`unknown operation surface "${key}"`)
  }
  return {
    deviceId: requireText(raw.deviceId, 'deviceId'),
    publicKey: requireText(raw.publicKey, 'publicKey'),
    // Optional rather than required so a registry written by an earlier version
    // still loads. A record without it cannot complete a handshake, and that
    // device has to pair again — but losing it silently is what this field is
    // here to prevent: pairing records it from the device's `hello`, and
    // normalization dropping it made every confirmed device fail with
    // `peer-signature-invalid` while the record looked complete.
    agreementKey: optionalText(raw.agreementKey, 'agreementKey'),
    name: requireText(raw.name, 'name'),
    status,
    surfaces: {
      agent: normalizeSurfaceList(surfaces.agent, 'agent'),
      // Closed by default: absent means empty, never "everything".
      host: normalizeSurfaceList(surfaces.host, 'host'),
    },
    platform: optionalText(raw.platform, 'platform'),
    fingerprint: optionalText(raw.fingerprint, 'fingerprint'),
    pairedAt: optionalTimestamp(raw.pairedAt, 'pairedAt'),
    lastSeenAt: optionalTimestamp(raw.lastSeenAt, 'lastSeenAt'),
  }
}

/** Normalize a whole registry, dropping nothing silently and sorting for stable diffs. */
export function normalizeRegistry(raw) {
  const source = raw === null || raw === undefined ? { version: REGISTRY_VERSION, devices: [] } : raw
  if (typeof source !== 'object' || Array.isArray(source)) fail('the registry must be an object')
  const version = source.version === undefined ? REGISTRY_VERSION : source.version
  if (version !== REGISTRY_VERSION) fail(`unsupported registry version ${version}`)
  if (source.devices !== undefined && !Array.isArray(source.devices)) fail('devices must be an array')
  const devices = (source.devices ?? []).map(normalizeDevice)
  const seen = new Set()
  for (const device of devices) {
    if (seen.has(device.deviceId)) fail(`duplicate deviceId "${device.deviceId}"`)
    seen.add(device.deviceId)
  }
  devices.sort((left, right) => left.deviceId.localeCompare(right.deviceId))
  return { version: REGISTRY_VERSION, devices }
}

/** An empty registry. */
export function emptyRegistry() {
  return { version: REGISTRY_VERSION, devices: [] }
}

/** Find one device, or `undefined`. */
export function findDevice(registry, deviceId) {
  return normalizeRegistry(registry).devices.find(device => device.deviceId === deviceId)
}

/** Every device, sorted by id. */
export function listDevices(registry) {
  return normalizeRegistry(registry).devices
}

/**
 * Devices that may currently reach the Agent.
 *
 * Only `trusted` qualifies. A `pending` device has been seen but not confirmed by
 * the local machine; a `revoked` one must not be resurrected by a later request.
 */
export function trustedDevices(registry) {
  return listDevices(registry).filter(device => device.status === DEVICE_STATUS.TRUSTED)
}

/**
 * Insert or replace a device record.
 *
 * A revoked device id stays revoked: re-pairing must mint a new id rather than
 * silently reviving the old one, otherwise revocation could be undone by anyone
 * who can reach the pairing entry point.
 */
export function upsertDevice(registry, device, now) {
  const current = normalizeRegistry(registry)
  const next = normalizeDevice(device)
  const existing = current.devices.find(entry => entry.deviceId === next.deviceId)
  if (existing?.status === DEVICE_STATUS.REVOKED && next.status !== DEVICE_STATUS.REVOKED) {
    fail(`device "${next.deviceId}" is revoked and cannot be revived; mint a new device id`)
  }
  const stamped = { ...next }
  if (existing === undefined && stamped.pairedAt === undefined) stamped.pairedAt = now
  const devices = current.devices.filter(entry => entry.deviceId !== next.deviceId)
  devices.push(stamped)
  return normalizeRegistry({ version: REGISTRY_VERSION, devices })
}

/**
 * Confirm a pending device on the local machine.
 *
 * This is the only transition into `trusted`. It refuses to confirm a device that
 * is unknown or already revoked, so a stale confirmation click cannot re-admit
 * a device the operator has since removed.
 */
export function confirmDevice(registry, deviceId, surfaces, now) {
  const current = normalizeRegistry(registry)
  const device = current.devices.find(entry => entry.deviceId === deviceId)
  if (device === undefined) fail(`cannot confirm unknown device "${deviceId}"`)
  if (device.status === DEVICE_STATUS.REVOKED) fail(`device "${deviceId}" is revoked`)
  const agent = surfaces?.agent === undefined ? [...DEFAULT_AGENT_SURFACE] : surfaces.agent
  // The narrow host surface is part of a confirmed device: the remote workspace
  // browser needs directory listing and workspace registration. Everything else on
  // the host surface stays refused by the gate's allowlist.
  const host = surfaces?.host === undefined ? [...DEFAULT_HOST_SURFACE] : surfaces.host
  return upsertDevice(current, {
    ...device,
    status: DEVICE_STATUS.TRUSTED,
    surfaces: { agent, host },
    lastSeenAt: now,
  }, now)
}

/**
 * Revoke a device.
 *
 * Returns the new registry *and* the record that was revoked, because revocation
 * is not finished by mutating a file: the caller must also tear down every live
 * connection this device currently holds. Refusing later requests is not enough —
 * an established stream keeps delivering events until it is closed.
 */
export function revokeDevice(registry, deviceId, now) {
  const current = normalizeRegistry(registry)
  const device = current.devices.find(entry => entry.deviceId === deviceId)
  if (device === undefined) fail(`cannot revoke unknown device "${deviceId}"`)
  if (device.status === DEVICE_STATUS.REVOKED) {
    return { registry: current, revoked: device }
  }
  const revoked = { ...device, status: DEVICE_STATUS.REVOKED, lastSeenAt: now }
  const devices = current.devices.map(entry => (entry.deviceId === deviceId ? revoked : entry))
  return { registry: normalizeRegistry({ version: REGISTRY_VERSION, devices }), revoked }
}

/** Drop a device record entirely (used when a pairing invitation is abandoned). */
export function removeDevice(registry, deviceId) {
  const current = normalizeRegistry(registry)
  if (!current.devices.some(entry => entry.deviceId === deviceId)) {
    fail(`cannot remove unknown device "${deviceId}"`)
  }
  return normalizeRegistry({
    version: REGISTRY_VERSION,
    devices: current.devices.filter(entry => entry.deviceId !== deviceId),
  })
}
