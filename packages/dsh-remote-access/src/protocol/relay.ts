/**
 * Relay protocol. Control messages are JSON text frames; once a device socket
 * and a Host socket are paired, the relay forwards binary messages verbatim
 * and never sees plaintext.
 *
 *   Host   → /v1/host             relay: challenge; Host: register; relay: registered, then one `connect` per device;
 *                                  the Host may send `ping` at any time and the relay answers `pong`; a registration
 *                                  by ID Token ends when the token expires, so the Host registers again before then
 *   Host   → /v1/host/accept      Host: accept { id } as the first frame, then the paired byte pipe
 *   Device → /v1/connect/<hostId> relay: open once the Host accepted, then the paired byte pipe
 *
 * The Host id is the base64url Ed25519 public key that signs registrations, so
 * the relay needs no account database to know who may serve under an id.
 */
import { base64url, fromBase64url, utf8 } from './bytes.ts'
import { PROTOCOL } from './constants.ts'

export const RELAY_PATHS = { host: '/v1/host', accept: '/v1/host/accept', connect: '/v1/connect/' } as const

export interface ControlMessage { readonly t: string; readonly [field: string]: unknown }

export type RelayToHost =
  | { readonly t: 'challenge'; readonly nonce: string }
  | { readonly t: 'registered' }
  /** A device is waiting; open {@link RELAY_PATHS.accept} and send `accept` with this id within the accept deadline. */
  | { readonly t: 'connect'; readonly id: string }
  | { readonly t: 'pong' }
/**
 * What admits a Host to the relay, never who may reach it: an access key the
 * operator issued, or an ID Token from the sign-in of an organization the
 * operator admits.
 */
export type RelayCredential = { readonly accessKey: string } | { readonly idToken: string }
export type Register = {
  readonly t: 'register'
  /** End-to-end protocol the Host speaks; the relay refuses versions its web client does not. */
  readonly protocol: string
  readonly hostId: string
  readonly sig: string
} & RelayCredential
export interface Accept { readonly t: 'accept'; readonly id: string }
export interface Open { readonly t: 'open' }

export function parseControl(text: string): ControlMessage | undefined {
  try {
    const message: unknown = JSON.parse(text)
    return typeof message === 'object' && message !== null && !Array.isArray(message) && typeof (message as ControlMessage).t === 'string'
      ? message as ControlMessage
      : undefined
  } catch {
    return undefined
  }
}

/** Bytes a Host signs to register: bound to this relay's public origin and its one-time nonce. */
const registration = (relayOrigin: string, nonce: string): Uint8Array<ArrayBuffer> => utf8(`${PROTOCOL} relay-register\0${relayOrigin}\0${nonce}`)

export const hostIdOf = async (publicKey: CryptoKey): Promise<string> => base64url(new Uint8Array(await crypto.subtle.exportKey('raw', publicKey)))

export async function signRegistration(privateKey: CryptoKey, relayOrigin: string, nonce: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, registration(relayOrigin, nonce))))
}

export async function verifyRegistration(hostId: string, relayOrigin: string, nonce: string, sig: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', fromBase64url(hostId), 'Ed25519', false, ['verify'])
    return await crypto.subtle.verify('Ed25519', key, fromBase64url(sig), registration(relayOrigin, nonce))
  } catch {
    return false
  }
}
