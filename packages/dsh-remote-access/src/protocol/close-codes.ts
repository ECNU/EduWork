/**
 * WebSocket close codes used by the relay, the Host and the browser. The relay
 * forwards a peer's code in the 4000–4999 range; they are diagnostics only and
 * never authorize anything (revocation travels inside the encrypted channel).
 */
export const Close = {
  normal: 1000,
  /** Malformed or unexpected message, failed decryption, oversized frame. */
  protocolError: 4400,
  /** Relay: unknown access key, invalid ID Token or Host registration signature, or the account's Host limit reached. */
  unauthorized: 4401,
  /** Host: the device was rejected or revoked; the reason was sent encrypted first. */
  forbidden: 4403,
  /** Relay: no Host is registered under the requested id. */
  hostOffline: 4404,
  /** Handshake, accept or heartbeat deadline passed, or the ID Token a Host registered with expired. */
  timeout: 4408,
  /** Relay: a newer verified registration took over this Host id. */
  replaced: 4409,
  /** Relay: the other end of this connection closed. */
  peerClosed: 4410,
  /** Relay: the Host speaks a protocol version this relay does not serve. */
  upgradeRequired: 4426,
  /** Rate, size or backlog limit exceeded; a Host retries later. */
  overLimit: 4429,
  /** Relay is shutting down or under maintenance. */
  unavailable: 4503,
} as const
