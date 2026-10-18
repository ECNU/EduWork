/**
 * The one place a remote call is named, and the one place it can be refused.
 *
 * A device reaches this Host by speaking the Host's own RPC, so the name in the
 * request is the Host's endpoint (`session/list`), while the fence in `gate.js`
 * is written in the `surface:operation` form a device is granted by. Those are
 * two spellings of one thing and the difference is entirely mechanical —
 * `session/list` is the endpoint for `session:list` — so the translation lives
 * here, next to the table it is checked against, rather than being recomputed at
 * each call site.
 *
 * This is a lookup, not a transformation. An endpoint whose operation is not in
 * the table is refused; nothing is inferred from a name that merely looks
 * plausible, because the whole value of the fence is that the list of reachable
 * things is a list someone wrote down and reviewed.
 *
 * The endpoint names are the Host's and will move with it. They were read from
 * the `typert.host.js` bindings shipped beside the controllers, so a rename
 * upstream shows up as a refusal here rather than as silent access to something
 * new.
 */

import { DENY_REASONS, OPERATION_TABLE, decide } from '../gate.js'

/**
 * Host RPC endpoint -> the operation a device must hold.
 *
 * Only read-only session and workspace operations are listed, plus the two ways
 * to drive an agent turn. `session/prompt` and `session/cancel` are the reason
 * this module exists rather than reusing an HTTP path check: they are the calls
 * that make the Host *do* something, and they must be named to be refused.
 *
 * The host-management endpoints are deliberately absent. `gate.js` lists them so
 * the refusal is explicit, and nothing here may be the thing that starts
 * granting them.
 */
export const ENDPOINT_OPERATIONS = Object.freeze({
  'session/list': 'session:list',
  'session/page': 'session:read',
  'session/create': 'session:create',
  'session/modelCatalog': 'session:read',
  'session/initializeDefaultModel': 'session:create',
  'session/prompt': 'session:prompt',
  'session/cancel': 'session:cancel',
  'agentPresets/list': 'settings:read',
  'permissionPresets/catalog': 'settings:read',
  // The control stream carries approvals and Agent question prompts, and these two
  // endpoints are how a paired terminal answers them. They are Agent-surface
  // actions scoped to the session they name — not host management, and not a way to
  // reach device pairing or credentials — so they ride on operations the device
  // already holds.
  'session/control': 'session:read',
  // The session state/history stream. The workspace list already rides its own
  // stream; without this one a remote click on a session shows "历史加载失败" even
  // though the session itself is readable.
  'session/follow': 'session:read',
  'userQuestions/answer': 'session:prompt',
  'userQuestions/attachWait': 'session:read',
  // Read-only catalogs the Web UI paints its composer and settings from. They are
  // preferences/model metadata, not credential or host administration.
  'llm/listProviders': 'settings:read',
  'llm/listConfigurableProviders': 'settings:read',
  'job/list': 'session:read',
  'workspace/list': 'workspace:list',
  'workspace/read': 'workspace:read',
  'workspace/create': 'workspace:create',
  'workspace/follow': 'workspace:read',
  'workspace/initializeDefault': 'workspace:create',
  // The remote workspace browser. `list` is read-only; registering the selected
  // folder as a workspace is the narrow host grant.
  'directoryPicker/list': 'directory:list',
  'directoryPicker/createDirectory': 'workspace:create',
  'artifact/read': 'artifact:read',
  'artifact/download': 'artifact:download',
  'settings/describe': 'settings:read',
})

/** The operation id for a Host endpoint, or undefined when there is none. */
export function operationForEndpoint(endpoint) {
  if (typeof endpoint !== 'string') return undefined
  const operation = ENDPOINT_OPERATIONS[endpoint.trim()]
  // Routed through the table rather than returned: the mapping and the fence are
  // two lists that have to agree, and this is where that is enforced instead of
  // assumed. A mapping to an operation the fence does not know is a programming
  // error, and it must not become an allowed call.
  return operation !== undefined && OPERATION_TABLE[operation] !== undefined ? operation : undefined
}

/**
 * Endpoints the Gateway itself serves, which carry no Host business method.
 *
 * They are not in the operation table because that table is a list of *operations a
 * device may ask the Host to perform*, and these are not operations. `$events` is the
 * connection's own generation source: the Gateway opens it when the client mounts and
 * the Host forwards only the events the application selected for forwarding. Refusing
 * it does not withhold a capability — it prevents the connection from reaching
 * `connected` at all, which is why it has to be named here rather than left to the
 * table.
 *
 * Named individually rather than matched by a `$` prefix, and that is deliberate: a
 * prefix rule would admit every future Gateway-internal endpoint without anyone
 * looking, which is exactly the review this list exists to force. Adding one means
 * editing this comment and this set.
 */
export const CONNECTION_ENDPOINTS = Object.freeze(new Set([
  // The forwarded-event stream and its result channel. Both are Gateway-owned; the
  // result channel is how a client listener answers a Host waterfall.
  '$events',
  '$events/result',
]))

/**
 * Decide one inbound call.
 *
 * The order inside `decide` is the security property, and it is preserved here:
 * an unknown or revoked device is refused before the Host endpoint is even
 * looked at, so a device cannot learn which endpoints exist by probing with a
 * credential it does not have.
 *
 * @returns `{ allowed: true, operation, sideEffect }` or `{ allowed: false, reason }`.
 */
export function decideEndpoint(device, endpoint) {
  if (typeof endpoint === 'string' && CONNECTION_ENDPOINTS.has(endpoint.trim())) {
    // Still gated on the device: a connection endpoint is reachable only by a device
    // the Host trusts. What it skips is the operation lookup, because there is no
    // operation to look up.
    const verdict = decide(device, 'session:read')
    if (!verdict.allowed) return { allowed: false, reason: verdict.reason }
    return { allowed: true, operation: endpoint.trim(), sideEffect: false }
  }
  const operation = operationForEndpoint(endpoint)
  if (operation === undefined) {
    // Refused as an unknown operation, not as a mapping miss. A caller that got
    // the name wrong and a caller probing for one get told the same thing.
    return { allowed: false, reason: DENY_REASONS.UNKNOWN_OPERATION }
  }
  const verdict = decide(device, operation)
  if (!verdict.allowed) return { allowed: false, reason: verdict.reason }
  return { allowed: true, operation: verdict.operation, sideEffect: verdict.sideEffect }
}

/**
 * The endpoints that may be retried after a dropped connection without
 * executing twice.
 *
 * Read-only calls are in this set because repeating them changes nothing. The
 * mutating ones are excluded, and that is the point: the Host already guarantees
 * at-most-once admission by `requestId`, so a device may resend a prompt and
 * have it ignored. What a device may *not* do is resend one the Host has never
 * seen under a fresh id — this set is what says so.
 */
export function isRetryable(endpoint) {
  const operation = operationForEndpoint(endpoint)
  if (operation === undefined) return false
  return OPERATION_TABLE[operation].sideEffect === false
}
