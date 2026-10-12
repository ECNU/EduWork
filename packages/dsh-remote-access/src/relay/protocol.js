/**
 * Wire constants shared by the relay, the Host dialer and the browser bootstrap.
 *
 * These live in their own module so the relay can be deployed without pulling in
 * the Host plugin, and so there is exactly one definition of each path and
 * version string. A mismatch here is a protocol break, not a configuration
 * difference.
 */

/** Relay protocol version. Bumped only on an incompatible control-frame change. */
export const RELAY_VERSION = 'eduwork-relay/1'

/** Upgrade path a Host dials out to. */
export const HOST_PATH = '/host'

/** Upgrade path a device opens, with `?h=<hostId>`. */
export const PEER_PATH = '/peer'

/** Path prefix the relay serves injected browser assets from. */
export const ASSET_PREFIX = '/eduwork-assets'

/** Filename of the injected browser bootstrap, as served under {@link ASSET_PREFIX}. */
export const BOOTSTRAP_FILE = 'bootstrap.js'

/** Handshake message types, in the order they travel. */
export const MESSAGE = Object.freeze({
  // relay <-> host
  CHALLENGE: 'challenge',
  REGISTER: 'register',
  REGISTERED: 'registered',
  DENIED: 'denied',
  // relay <-> peer
  LINKED: 'linked',
  UNAVAILABLE: 'unavailable',
  PEER_JOINED: 'peer-joined',
  PEER_GONE: 'peer-gone',
  /**
   * Either side: "I have finished taking control frames, forward everything now."
   *
   * This exists because the relay's control channel and the end-to-end
   * handshake share one socket. Without an explicit hand-off, the relay's own
   * `peer-joined` frame lands in the middle of the handshake and the Host parses
   * it as a `hello`, failing with a protocol mismatch. The first implementation
   * did exactly that.
   *
   * Both sides must send it before the relay switches to transparent
   * forwarding, so neither can have a handshake frame delayed behind the other's
   * setup.
   */
  READY: 'ready',
  // peer <-> host, carried opaquely by the relay
  HELLO: 'hello',
  HOST: 'host',
  PROVE: 'prove',
})

/** Reason a `unavailable` frame was sent, for the phone's error text. */
export const UNAVAILABLE = Object.freeze({
  UNKNOWN_HOST: 'unknown-host',
  HOST_OFFLINE: 'host-offline',
  HOST_BUSY: 'host-busy',
  MISSING_HOST_ID: 'missing-host-id',
})
