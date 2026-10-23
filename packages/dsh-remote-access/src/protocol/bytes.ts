/** Byte helpers shared by the browser and the Host; only Web platform APIs. */

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const BASE64URL = /^[A-Za-z0-9_-]*$/

export const utf8 = (text: string): Uint8Array<ArrayBuffer> => encoder.encode(text)
export const fromUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes)

export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** Strict inverse of {@link base64url}; throws on any other alphabet or on padding. */
export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  if (!BASE64URL.test(text) || text.length % 4 === 1) throw new TypeError('invalid base64url')
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

/** Comparison whose duration does not depend on where the inputs differ. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  let diff = 0
  for (let i = 0; i < a.byteLength; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

export const randomBytes = (length: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(length))
