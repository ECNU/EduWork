/**
 * The unary request and response envelope, and the client's decoder for it.
 *
 * Both sides of the encrypted channel need this shape, and the reason it lives in
 * its own module is that getting it wrong is invisible at the sending end and
 * catastrophic at the receiving end. The device's decoder is strict:
 *
 *   - `type` must be exactly `server-response` and `rpcId` a string;
 *   - `result` must be a record whose `ok` is exactly `true` or `false`;
 *   - on failure, `code`, `message` and `details` must **all** be present, with
 *     `code` and `message` strings and `details` a record.
 *
 * A `{ code: 500 }`-style shape is refused outright, so a Host that answers with one
 * does not report its failure — the device reports a transport error instead. Two
 * separate defects of exactly that kind were found by handing envelopes to this
 * decoder rather than to an assertion about the fields, which is why the decoder is
 * the thing exported here.
 *
 * The decoder is implemented here against the documented envelope contract rather
 * than lifted out of a shipped bundle. The device client does not export its
 * parser, and reading a private file path was both a packaging dependency and a
 * source of breakage when DSH moved from one client bundle to platform-specific
 * ones. The rules below are the public contract the device applies; the tests
 * exercise them directly, including the failure shapes that used to reach the
 * device as transport errors.
 */

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate one inbound response using the device client's strict rules.
 *
 * This is deliberately not permissive: a response that does not match exactly is
 * rejected, because the device would reject it and report a transport error
 * instead of the Host's reason. Keeping the same strictness here means a Host bug
 * is caught at the Host rather than surfacing three layers away.
 */
export function decodeResponse(value) {
  if (!isRecord(value) || value.type !== 'server-response' || typeof value.rpcId !== 'string') {
    throw new TypeError('connection: invalid server-response envelope')
  }
  const result = value.result
  if (!isRecord(result)) throw new TypeError('connection: invalid server-response result')
  if (result.ok === true) {
    return {
      rpcId: value.rpcId,
      result: { ok: true, value: result.value },
    }
  }
  if (result.ok !== false || !isRecord(result.error)) {
    throw new TypeError('connection: invalid server-response result')
  }
  const error = result.error
  if (typeof error.code !== 'string' || typeof error.message !== 'string' || !isRecord(error.details)) {
    throw new TypeError('connection: invalid server-response failure')
  }
  return {
    rpcId: value.rpcId,
    result: {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    },
  }
}

/**
 * Validate one inbound frame as a JSON object.
 *
 * Frames on this channel are JSON text, and the first thing to decide about any of
 * them is whether it parsed into an object at all. Returning the value rather than
 * a boolean keeps callers from re-checking what this already established.
 */
export function parseRpcEnvelope(text) {
  const value = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('remote-access: a frame must be a JSON object')
  }
  return value
}

/**
 * Build the success envelope.
 *
 * `value` is passed through unchanged: the client applies its own codec on the way
 * in, and re-encoding here would make this side responsible for a type projection it
 * does not own.
 */
export function serverResponse(rpcId, value) {
  return { type: 'server-response', rpcId, result: { ok: true, value } }
}

/**
 * Build the failure envelope.
 *
 * Every field is repaired rather than trusted, because a failure is exactly the
 * moment a Host is most likely to hand over something malformed — a numeric status,
 * a missing detail record, an error that is not an `Error`. Repairing keeps the
 * envelope decodable; it does not invent a cause, since the message is passed
 * through and the original fields that failed the check are preserved in `details`.
 */
export function serverFailure(rpcId, error) {
  const source = error !== null && typeof error === 'object' ? error : {}
  const code = typeof source.code === 'string' && source.code !== '' ? source.code : 'host/internal'
  const message = typeof source.message === 'string' && source.message !== ''
    ? source.message
    : String(source.message ?? error ?? 'the host failed this call')
  const details = source.details !== null && typeof source.details === 'object' && !Array.isArray(source.details)
    ? source.details
    : {}
  return { type: 'server-response', rpcId, result: { ok: false, error: { code, message, details } } }
}
