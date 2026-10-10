/**
 * Operation-surface fence: the single place that decides what a remote device
 * may ask this Host to do.
 *
 * Two facts about the layer below make this module necessary rather than
 * decorative. The official `/api` surface, once a request passes the Host fence
 * and browser authentication, is admitted *as the operator* — upstream states
 * that outright, and the operator grant is the same one the local GUI holds.
 * Remote access therefore has to be narrowed **here**, because nothing
 * downstream narrows it.
 *
 * The rules are deliberately boring:
 *
 * - **Deny by default.** An operation absent from the table is refused, and a
 *   surface absent from the device grant is refused. Adding a capability means
 *   editing this table, which is the point: the diff is the review.
 * - **Host management stays closed.** Pairing, credential handling and device
 *   administration are a separate surface. A device granted the Agent surface
 *   does not thereby reach them.
 * - **Unknown devices are refused before any lookup.** A pending or revoked
 *   device is refused on the same path as an unknown one.
 *
 * The module is pure: no I/O, no clock. That is what lets the acceptance item
 * "an unauthorised device cannot reach sessions or files" be tested directly
 * rather than argued about.
 */

import { DEVICE_STATUS } from './registry.js'

/** The two surfaces. Kept in step with `registry.js`. */
export const SURFACE_AGENT = 'agent'
export const SURFACE_HOST = 'host'

/**
 * Whether a remote client may reach the host management surface at all.
 *
 * v1 says no, and this is a hard gate rather than a default: pairing and
 * credential handling are a different thing from operating the Agent, and the
 * cheapest way to keep that distinction true is to make the surface
 * unreachable regardless of what a device record happens to contain. Flipping
 * this is a deliberate act with its own review, not a configuration value.
 */
export const HOST_SURFACE_ENABLED = false

/**
 * Every operation a remote client may name, and what it needs.
 *
 * `sideEffect` marks calls that change state. Those carry a client-generated
 * `requestId` so a reconnect can be retried without executing twice — the
 * acceptance item "reconnecting does not repeat an operation" is implemented
 * against this flag, so a new mutating operation must set it.
 */
export const OPERATION_TABLE = Object.freeze({
  'session:list': { surface: SURFACE_AGENT, sideEffect: false },
  'session:read': { surface: SURFACE_AGENT, sideEffect: false },
  'session:prompt': { surface: SURFACE_AGENT, sideEffect: true },
  'session:cancel': { surface: SURFACE_AGENT, sideEffect: true },
  'workspace:list': { surface: SURFACE_AGENT, sideEffect: false },
  'workspace:read': { surface: SURFACE_AGENT, sideEffect: false },
  'artifact:read': { surface: SURFACE_AGENT, sideEffect: false },
  'artifact:download': { surface: SURFACE_AGENT, sideEffect: false },
  'settings:read': { surface: SURFACE_AGENT, sideEffect: false },

  // Host management. Listed so the refusal is explicit and testable, never
  // granted by `confirmDevice`, and never reachable from a remote client.
  'device:list': { surface: SURFACE_HOST, sideEffect: false },
  'device:confirm': { surface: SURFACE_HOST, sideEffect: true },
  'device:revoke': { surface: SURFACE_HOST, sideEffect: true },
  'invitation:create': { surface: SURFACE_HOST, sideEffect: true },
  'credential:read': { surface: SURFACE_HOST, sideEffect: false },
  'credential:write': { surface: SURFACE_HOST, sideEffect: true },
  'plugin:install': { surface: SURFACE_HOST, sideEffect: true },
  'plugin:uninstall': { surface: SURFACE_HOST, sideEffect: true },
  'terminal:open': { surface: SURFACE_HOST, sideEffect: true },
})

const REASONS = Object.freeze({
  UNKNOWN_DEVICE: 'unknown-device',
  NOT_TRUSTED: 'device-not-trusted',
  UNKNOWN_OPERATION: 'unknown-operation',
  NOT_GRANTED: 'operation-not-granted',
})

function refuse(reason) {
  return { allowed: false, reason }
}

/**
 * Decide one operation for one device.
 *
 * Order matters: the device is judged before the operation, so a caller cannot
 * learn whether an operation exists by probing with an unauthorised device.
 *
 * @returns `{ allowed: true, operation, surface, sideEffect }` or
 *          `{ allowed: false, reason }`.
 */
export function decide(device, operation) {
  if (device === undefined || device === null) return refuse(REASONS.UNKNOWN_DEVICE)
  if (device.status !== DEVICE_STATUS.TRUSTED) return refuse(REASONS.NOT_TRUSTED)
  if (typeof operation !== 'string' || operation.trim() === '') {
    return refuse(REASONS.UNKNOWN_OPERATION)
  }
  const entry = OPERATION_TABLE[operation.trim()]
  if (entry === undefined) return refuse(REASONS.UNKNOWN_OPERATION)
  // The host surface is unreachable in v1 no matter what the record says.
  if (entry.surface === SURFACE_HOST && !HOST_SURFACE_ENABLED) return refuse(REASONS.NOT_GRANTED)
  const granted = device.surfaces?.[entry.surface]
  if (!Array.isArray(granted) || !granted.includes(operation.trim())) {
    return refuse(REASONS.NOT_GRANTED)
  }
  return { allowed: true, operation: operation.trim(), surface: entry.surface, sideEffect: entry.sideEffect }
}

/** Convenience for callers that only need a yes/no. */
export function isAllowed(device, operation) {
  return decide(device, operation).allowed
}

/**
 * Refuse every operation on the host surface for a grant, whatever it contains.
 *
 * Remote clients never administer the Host in v1. The function exists so the
 * rule is applied in one place and can be asserted, rather than being an
 * assumption spread across call sites.
 */
export function stripHostSurface(surfaces) {
  return { agent: [...(surfaces?.agent ?? [])], host: [] }
}

/** The operations a device may currently perform, sorted. */
export function grantedOperations(device) {
  if (device === undefined || device === null) return []
  if (device.status !== DEVICE_STATUS.TRUSTED) return []
  return Object.keys(OPERATION_TABLE)
    .filter(operation => decide(device, operation).allowed)
    .sort()
}

export { REASONS as DENY_REASONS }
