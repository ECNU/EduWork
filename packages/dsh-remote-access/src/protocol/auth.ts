/**
 * Device identity and pairing. A device holds a non-extractable ECDSA P-256
 * key (WebCrypto). After the Noise handshake it signs the handshake hash, so
 * the signature proves possession for this one connection and cannot be
 * replayed on another. Both sides derive the pairing code from the same hash.
 */
import { base64url, concat, fromBase64url, randomBytes, utf8 } from './bytes.ts'
import { PROTOCOL } from './constants.ts'

const AUTH_CONTEXT = utf8(`${PROTOCOL} device-auth\0`)
const CODE_CONTEXT = utf8(`${PROTOCOL} pairing-code\0`)
const P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' } as const
export const MAX_DEVICE_NAME = 64

/** First frame the device sends on a new channel. `invite` and `name` only accompany a first pairing. */
export type AuthFrame = {
  readonly t: 'auth'
  /** Raw uncompressed P-256 public key, base64url; it identifies the device. */
  readonly key: string
  /** P1363 signature over this connection's handshake hash. */
  readonly sig: string
  readonly invite?: string
  readonly name?: string
}

/** The Host's answers to `auth`. Only `ready` lets the device send exchanges; `rejected` and `revoked` are followed by close. */
export type AuthReply =
  | { readonly t: 'pending'; readonly host: string }
  | { readonly t: 'ready'; readonly host: string }
  | { readonly t: 'rejected'; readonly reason: 'unknown-device' | 'invalid-invite' | 'declined' | 'timeout' }
  | { readonly t: 'revoked' }

/** A new device key: pages of this origin can sign with it but cannot read it. */
export const generateDeviceKey = (): Promise<CryptoKeyPair> => crypto.subtle.generateKey(P256, false, ['sign', 'verify'])

export async function deviceAuth(keyPair: CryptoKeyPair, hash: Uint8Array, pairing?: { invite: string; name: string }): Promise<AuthFrame> {
  const key = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  const sig = new Uint8Array(await crypto.subtle.sign(SIGNATURE, keyPair.privateKey, concat(AUTH_CONTEXT, hash)))
  return { t: 'auth', key: base64url(key), sig: base64url(sig), ...pairing }
}

/** Host side: the verified `auth` frame, or undefined when it is malformed or not signed for this connection. */
export async function verifyAuth(frame: { readonly [K in keyof AuthFrame]?: unknown }, hash: Uint8Array): Promise<AuthFrame | undefined> {
  const { t, key, sig, invite, name } = frame
  if (t !== 'auth' || typeof key !== 'string' || typeof sig !== 'string') return undefined
  if (invite !== undefined && typeof invite !== 'string') return undefined
  if (name !== undefined && (typeof name !== 'string' || name.length > MAX_DEVICE_NAME)) return undefined
  try {
    const publicKey = await crypto.subtle.importKey('raw', fromBase64url(key), P256, false, ['verify'])
    if (!await crypto.subtle.verify(SIGNATURE, publicKey, fromBase64url(sig), concat(AUTH_CONTEXT, hash))) return undefined
  } catch {
    return undefined
  }
  return { t, key, sig, ...invite !== undefined && { invite }, ...name !== undefined && { name } }
}

/** Six digits both sides show while the Host owner confirms a new device. */
export async function pairingCode(hash: Uint8Array): Promise<string> {
  const digest = new DataView(await crypto.subtle.digest('SHA-256', concat(CODE_CONTEXT, hash)))
  return String(digest.getUint32(0) % 1_000_000).padStart(6, '0')
}

/** What a pairing link carries after `#`; browsers never send the fragment to the relay. */
export interface PairingLink {
  readonly hostId: string
  /** The Host's Noise static public key, pinned for every later connection. */
  readonly hostKey: Uint8Array
  readonly invite: string
}

export const newInvite = (): string => base64url(randomBytes(16))

/** The link a device opens to pair: the relay's base URL (see `relayBase`), the rest in the fragment, which browsers never send. */
export function formatPairingLink(relay: string, { hostId, hostKey, invite }: PairingLink): string {
  return `${relay}#${hostId}.${base64url(hostKey)}.${invite}`
}

export function parsePairingLink(fragment: string): PairingLink | undefined {
  const [hostId, hostKey, invite, ...rest] = fragment.replace(/^#/, '').split('.')
  try {
    const link = { hostId: hostId!, hostKey: fromBase64url(hostKey!), invite: invite! }
    return rest.length === 0 && fromBase64url(link.hostId).length === 32 && link.hostKey.length === 32 && fromBase64url(link.invite).length === 16
      ? link
      : undefined
  } catch {
    return undefined
  }
}
