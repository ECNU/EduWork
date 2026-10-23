/**
 * ID Tokens from one OpenID Connect issuer, as a relay that admits an
 * organization's members checks them: an RS256 signature by a key the
 * issuer publishes, this issuer, issued to one of the given clients, and
 * still valid. The relay keeps only the subject; it never logs a token.
 */
import { fromBase64url } from '../protocol/bytes.ts'

export interface IdTokenOptions {
  /** The issuer exactly as its tokens name it, e.g. `https://sso.example.edu`. */
  readonly issuer: string
  /** Client IDs of the applications whose sign-in admits a Host. */
  readonly clientIds: readonly string[]
  readonly fetch?: typeof fetch
  readonly now?: () => number
}

export interface Member {
  readonly subject: string
  /** Unix seconds. */
  readonly expiresAt: number
}

const SKEW_SECONDS = 60
/** Keys are fetched again after this, so a key the issuer withdrew stops working. */
const KEYS_MAX_AGE_MS = 60 * 60_000
/** A token naming a key not yet known fetches the keys at most this often. */
const KEYS_MIN_INTERVAL_MS = 60_000

const decode = (part: string): Record<string, unknown> => JSON.parse(new TextDecoder().decode(fromBase64url(part)))

/** The issuer's keys could not be had; the token may be fine, so the Host should try again later. */
export class IssuerUnavailable extends Error {}

type Jwk = JsonWebKey & { readonly kid?: unknown }

export class IdTokens {
  readonly #options: IdTokenOptions & Required<Pick<IdTokenOptions, 'fetch' | 'now'>>
  #keys = new Map<string, CryptoKey>()
  /** When the keys were last fetched, and last tried. */
  #fetched = -Infinity
  #tried = -Infinity
  #fetching: Promise<void> | undefined

  constructor(options: IdTokenOptions) {
    this.#options = { fetch: globalThis.fetch, now: Date.now, ...options }
  }

  /** The member the token names; rejects a token this issuer did not sign for these clients or that has expired. */
  async verify(token: string): Promise<Member> {
    const [header, payload, signature, ...rest] = token.split('.')
    if (header === undefined || payload === undefined || signature === undefined || rest.length > 0) throw new Error('malformed token')
    const { alg, kid } = decode(header)
    if (alg !== 'RS256' || typeof kid !== 'string') throw new Error('token must be RS256 with a key id')
    const key = await this.#key(kid)
    const signed = new TextEncoder().encode(`${header}.${payload}`)
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64url(signature), signed)) throw new Error('bad signature')
    const claims = decode(payload)
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    // The client the token was issued to: its authorized party, or else its only audience. It must be one of
    // ours and in the audience, so a token for several audiences counts only with `azp` naming one of ours.
    const client = claims.azp ?? (audience.length === 1 ? audience[0] : undefined)
    if (claims.iss !== this.#options.issuer || !this.#options.clientIds.includes(client as string) || !audience.includes(client)) {
      throw new Error('token is not for this relay')
    }
    const now = this.#options.now() / 1000
    const { sub, exp, iat, nbf } = claims
    if (typeof sub !== 'string' || sub === '' || typeof exp !== 'number' || typeof iat !== 'number' || (nbf !== undefined && typeof nbf !== 'number')) {
      throw new Error('token lacks its subject or times')
    }
    if (exp < now - SKEW_SECONDS || iat > now + SKEW_SECONDS || (typeof nbf === 'number' && nbf > now + SKEW_SECONDS)) throw new Error('token expired or not yet valid')
    return { subject: sub, expiresAt: exp }
  }

  async #key(kid: string): Promise<CryptoKey> {
    const now = this.#options.now()
    if (this.#fetching === undefined && (now - this.#fetched > KEYS_MAX_AGE_MS || !this.#keys.has(kid)) && now - this.#tried > KEYS_MIN_INTERVAL_MS) {
      this.#tried = now
      this.#fetching = this.#fetch().finally(() => { this.#fetching = undefined })
    }
    // While the issuer does not answer, the keys it gave earlier keep working.
    const fetched = await this.#fetching?.then(() => true, () => false)
    const key = this.#keys.get(kid)
    if (key !== undefined) return key
    throw fetched === true ? new Error('unknown signing key') : new IssuerUnavailable('the issuer\'s signing keys are unavailable')
  }

  async #fetch(): Promise<void> {
    const { issuer, fetch } = this.#options
    const discovery = await json(fetch, `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`)
    if (discovery.issuer !== issuer || typeof discovery.jwks_uri !== 'string') throw new Error('issuer discovery does not match')
    const { keys } = await json(fetch, discovery.jwks_uri)
    const next = new Map<string, CryptoKey>()
    for (const jwk of Array.isArray(keys) ? keys as Jwk[] : []) {
      if (jwk.kty !== 'RSA' || typeof jwk.kid !== 'string' || (jwk.use !== undefined && jwk.use !== 'sig')) continue
      next.set(jwk.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']))
    }
    this.#keys = next
    this.#fetched = this.#options.now()
  }
}

async function json(fetch: typeof globalThis.fetch, url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return await response.json() as Record<string, unknown>
}
