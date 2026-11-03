import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { patchPromptCacheKeyRuntime, patchPromptCacheKeySource, promptCacheKeyPatch } from '../patch-prompt-cache-key-runtime.mjs'

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('unqualified source is rejected before mutation', () => {
  assert.throws(() => patchPromptCacheKeySource(Buffer.from('unreviewed Runtime')), /input changed/)
})

test('packaged adapter strips prompt_cache_key off OpenAI', { skip: !runtime }, async t => {
  const require = createRequire(join(runtime, 'package.json'))
  const originalPath = require.resolve(promptCacheKeyPatch.package)
  const original = await readFile(originalPath)
  const temporary = await mkdtemp(join(tmpdir(), 'eduwork-cache-key-backport-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const packageRoot = join(temporary, 'node_modules', promptCacheKeyPatch.package)
  await mkdir(join(packageRoot, 'lib'), { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), await readFile(join(dirname(originalPath), '../package.json')))
  await writeFile(join(packageRoot, promptCacheKeyPatch.file), original)
  await patchPromptCacheKeyRuntime(join(temporary, 'node_modules'))
  assert.deepEqual(await readFile(originalPath), original, 'verified npm input is untouched')
  await assert.rejects(patchPromptCacheKeyRuntime(join(temporary, 'node_modules')), /input changed/, 'do not patch twice')

  const patched = await readFile(join(packageRoot, promptCacheKeyPatch.file), 'utf8')
  const body = patched.slice(patched.indexOf('function profileOptions('), patched.indexOf('function eduworkStripPromptCacheKey('))
    + patched.slice(patched.indexOf('function eduworkStripPromptCacheKey(')).split('\n}\n')[0] + '\n}\n'
  const { profileOptions } = new Function(body + 'return { profileOptions }')()
  const strip = profileOptions({}, 'off', undefined).onPayload
  const payload = { model: 'glm', input: [], prompt_cache_key: 's', prompt_cache_retention: '24h' }
  assert.deepEqual(strip(payload, { baseUrl: 'https://gateway.example/v1' }), { model: 'glm', input: [] })
  assert.equal(strip(payload, { baseUrl: 'https://api.openai.com/v1' }), undefined)
  assert.equal(strip({ model: 'glm' }, { baseUrl: 'https://gateway.example/v1' }), undefined)
  assert.equal(profileOptions({ cacheRetention: 'long' }, 'off', undefined).onPayload, undefined)
})
