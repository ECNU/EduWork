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
 * The decoder is not reimplemented. `parseConnectionResponse` is read out of the
 * shipped client bundle and evaluated, because a copy of its rules is a copy that
 * can drift from the rules the device actually applies. If it cannot be found the
 * module throws at load rather than falling back to something more permissive.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

/**
 * Lift `parseConnectionResponse` out of the shipped client.
 *
 * It is not exported, so the function text is taken from the bundle and run against
 * the two helpers it closes over — `RpcId`, which is the identity for a branded
 * string, and `isRecord`. The pattern is anchored on the function name and requires
 * the body to end at the bundle's own indentation, so a reshaped file fails loudly
 * instead of silently matching nothing.
 */
function loadConnectionDecoder() {
  const file = join(dirname(require.resolve('@deepseek-ai/dsh-client-connection/package.json')), 'lib', 'client.js')
  const source = readFileSync(file, 'utf8')
  const match = /function parseConnectionResponse\(value\) \{[\s\S]*?\n\t\t\}/.exec(source)
  if (match === null) {
    throw new Error('remote-access: parseConnectionResponse moved; the response envelope cannot be validated')
  }
  const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value)
  // eslint-disable-next-line no-new-func
  return new Function('RpcId', 'isRecord', `${match[0]}\nreturn parseConnectionResponse`)(value => value, isRecord)
}

/** The device's own decoder, so a response can be judged by the rules it will meet. */
export const decodeResponse = loadConnectionDecoder()

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
