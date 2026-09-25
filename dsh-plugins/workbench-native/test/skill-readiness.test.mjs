import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
const hooks = registerHooks({ resolve(specifier, context, next) {
  const sources = {
    '@chatecnu-work/dsh-skill-control-native/core': '../../skill-control-native/lib/core.js',
    '@chatecnu-work/dsh-skill-settings-native/policy': '../../skill-settings-native/lib/policy.js',
  }
  return next(sources[specifier] ? new URL(sources[specifier], import.meta.url).href : specifier, context)
} })
const { skillReadiness } = await import('../lib/skill-readiness.js')
test.after(() => hooks.deregister())

const binding = { profileID: 'school', runtimeBaseURL: 'https://models.example.test/v1' }
test('account-only skills follow that account while endpoint authorization remains in the tool', async () => {
  let status = { profileID: 'school', state: 'signed_out', credentialReady: false }
  const ctx = { get: () => ({ status: async () => status }) }
  const requirements = { binding: { profileID: 'school' } }
  assert.equal((await skillReadiness(ctx, requirements)).available, false)
  status = { profileID: 'school', state: 'connected', credentialReady: true }
  assert.equal((await skillReadiness(ctx, requirements)).available, true)
  status = { ...status, profileID: 'other-school' }
  assert.equal((await skillReadiness(ctx, requirements)).available, false)
  status = { profileID: 'school', state: 'authenticated', credentialReady: false }
  assert.equal((await skillReadiness(ctx, requirements)).available, false)
})
test('organization skills follow sign-in and sign-out without requiring a legacy API key', async () => {
  let signedIn = false
  const ctx = {
    get: () => ({ modelAuthorization: async (id, url) => signedIn && id === binding.profileID && url === binding.runtimeBaseURL }),
    credentials: { describe: () => { throw Error('Account-bound skills must not read personal keys') } },
  }
  const requirements = { binding, credential: 'OLD_API_KEY' }
  assert.deepEqual(await skillReadiness(ctx, requirements), { available: false, requirement: '请登录或检查机构账号连接' })
  signedIn = true
  assert.deepEqual(await skillReadiness(ctx, requirements), { available: true, requirement: '' })
  assert.equal((await skillReadiness(ctx, { binding: { ...binding, runtimeBaseURL: 'https://other.example.test/v1' } })).available, false)
  signedIn = false
  assert.equal((await skillReadiness(ctx, requirements)).available, false)
})

test('missing configuration, missing account service and transient failures have distinct feedback', async () => {
  const ctx = { get: () => undefined, credentials: { describe: async () => ({ configured: false }) } }
  assert.equal((await skillReadiness(ctx, { binding })).requirement, '机构账号服务暂不可用')
  assert.equal((await skillReadiness(ctx, { credential: 'PERSONAL_API_KEY' })).requirement, '需要配置相应服务')
  assert.equal((await skillReadiness(ctx, {})).available, true)
  ctx.get = () => ({ modelAuthorization: async () => { throw Error('Temporary outage') } })
  assert.equal((await skillReadiness(ctx, { binding })).requirement, '暂时无法检查服务，请稍后重试')
})

test('sign-in alone does not enable an unconfigured image capability', async () => {
  let imageReady = false
  const ctx = { get: name => name === 'oidcAccounts' ? { modelAuthorization: async () => true }
    : { images: { list: async () => [{ available: imageReady }] } } }
  assert.equal((await skillReadiness(ctx, { binding, capability: 'image-generation' })).available, false)
  imageReady = true
  assert.equal((await skillReadiness(ctx, { binding, capability: 'image-generation' })).available, true)
})
