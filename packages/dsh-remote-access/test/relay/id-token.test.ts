import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, type KeyPairKeyObjectResult } from 'node:crypto'
import test from 'node:test'
import { IdTokens, IssuerUnavailable } from '../../src/relay/id-token.ts'

const ISSUER = 'https://sso.example.edu'
const CLIENT = 'desktop-app'

/** A synthetic issuer: its discovery and keys behind a stub fetch, and tokens signed by whichever key is current. */
function issuer() {
  const state = { kid: 'k1', down: false, fetches: 0, now: Date.now() }
  const pairs = new Map<string, KeyPairKeyObjectResult>()
  const pair = (kid: string): KeyPairKeyObjectResult => {
    if (!pairs.has(kid)) pairs.set(kid, generateKeyPairSync('rsa', { modulusLength: 2048 }))
    return pairs.get(kid)!
  }
  const fetch = (async (url: string) => {
    state.fetches++
    if (state.down) return new Response('', { status: 503 })
    if (url === `${ISSUER}/.well-known/openid-configuration`) return Response.json({ issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` })
    if (url === `${ISSUER}/jwks`) return Response.json({ keys: [{ ...pair(state.kid).publicKey.export({ format: 'jwk' }), kid: state.kid, use: 'sig', alg: 'RS256' }] })
    return new Response('', { status: 404 })
  }) as typeof globalThis.fetch
  const now = Math.floor(state.now / 1000)
  const token = (claims: Record<string, unknown> = {}, kid = state.kid, alg = 'RS256') => {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const signed = `${part({ alg, kid })}.${part({ iss: ISSUER, aud: CLIENT, sub: 'alice', iat: now, exp: now + 3600, name: 'Alice', ...claims })}`
    return `${signed}.${sign('RSA-SHA256', Buffer.from(signed), pair(kid).privateKey).toString('base64url')}`
  }
  const verifier = new IdTokens({ issuer: ISSUER, clientIds: [CLIENT, 'web-app'], fetch, now: () => state.now })
  return { state, token, verifier, now }
}

test('a token this issuer signed for one of the clients names its member until it expires', async () => {
  const { token, verifier, now } = issuer()
  assert.deepEqual(await verifier.verify(token()), { subject: 'alice', expiresAt: now + 3600 })
  assert.equal((await verifier.verify(token({ aud: ['web-app', 'other'], azp: 'web-app' }))).subject, 'alice')
  assert.equal((await verifier.verify(token({ azp: CLIENT }))).subject, 'alice')
})

test('tokens from elsewhere, for others, expired or tampered with are refused', async () => {
  const { token, verifier, now } = issuer()
  const tampered = token().split('.')
  tampered[1] = Buffer.from(JSON.stringify({ iss: ISSUER, aud: CLIENT, sub: 'mallory', iat: now, exp: now + 3600 })).toString('base64url')
  const cases: [string, string][] = [
    ['another issuer', token({ iss: 'https://sso.example.org' })],
    ['another client', token({ aud: 'someone-else' })],
    ['several audiences without this client as the authorized party', token({ aud: [CLIENT, 'other'] })],
    ['several audiences, authorized to another party', token({ aud: [CLIENT, 'other'], azp: 'other' })],
    ['our audience, authorized to another party', token({ azp: 'other' })],
    ['authorized to our client, which is not in the audience', token({ aud: 'other', azp: CLIENT })],
    ['expired', token({ exp: now - 120 })],
    ['not yet valid', token({ nbf: now + 600 })],
    ['issued in the future', token({ iat: now + 600 })],
    ['no subject', token({ sub: '' })],
    ['not RS256', token({}, 'k1', 'HS256')],
    ['tampered', tampered.join('.')],
    ['not a token', 'nonsense'],
  ]
  for (const [name, value] of cases) await assert.rejects(verifier.verify(value), error => !(error instanceof IssuerUnavailable), name)
})

test('keys are fetched once, again for a new key id at most every minute, and kept through an outage', async () => {
  const { state, token, verifier } = issuer()
  await verifier.verify(token())
  await verifier.verify(token())
  assert.equal(state.fetches, 2, 'discovery and keys, once')

  // The issuer rotates its key: a token naming the new one fetches the keys again, but not within a minute of the last fetch.
  state.kid = 'k2'
  await assert.rejects(verifier.verify(token()), IssuerUnavailable)
  assert.equal(state.fetches, 2)
  state.now += 61_000
  assert.equal((await verifier.verify(token())).subject, 'alice')
  assert.equal(state.fetches, 4)
  // A key id the issuer does not publish, once fetched again, is simply unknown.
  state.now += 61_000
  await assert.rejects(verifier.verify(token({}, 'k3')), error => !(error instanceof IssuerUnavailable))
  assert.equal(state.fetches, 6)

  // An hour on, the keys are due again; while the issuer is down, the ones fetched before still verify.
  state.now += 61 * 60_000
  state.down = true
  const current = { iat: Math.floor(state.now / 1000), exp: Math.floor(state.now / 1000) + 600 }
  assert.equal((await verifier.verify(token(current))).subject, 'alice')
  assert.equal(state.fetches, 7)
  await assert.rejects(verifier.verify(token(current, 'k4')), IssuerUnavailable)
})
