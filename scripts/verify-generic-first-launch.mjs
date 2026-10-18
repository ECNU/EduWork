import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from '../dsh-host/vendor/jsonc-parser/parser.js'
import { releaseIdentity } from '../dsh-host/release-policy.mjs'

export function verifyGenericFirstLaunch(identity, config) {
  assert.equal(identity.distribution, 'eduwork')
  const stable = releaseIdentity(identity.version, identity.dshVersion).publishable
  assert.equal(identity.sourceRelease, stable)
  assert.equal(identity.sourceAlpha, !stable)
  assert.equal(identity.automaticUpdates, true)
  assert.deepEqual(config.organizations, [])
  assert.equal(config.product.name, 'EduWork')
  if (stable) {
    assert.equal(config.updates.provider, 'github')
    assert.equal(config.updates.repository, 'ECNU/EduWork')
    assert.equal(config.updates.defaultPolicy, 'stable')
  } else {
    const { macFeeds, ...policy } = config.updates
    assert.deepEqual(policy, {provider:'github', repository:'ECNU/EduWork', defaultPolicy:'development'})
  }
  if (Object.hasOwn(config.updates, 'macFeeds')) {
    const feeds = config.updates.macFeeds
    assert.ok(feeds && typeof feeds === 'object' && !Array.isArray(feeds))
    for (const [channel, value] of Object.entries(feeds)) {
      assert.ok(['stable','development'].includes(channel))
      const url = new URL(value)
      assert.ok(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash)
    }
  }
  return { passed: true, channel: stable ? 'stable' : 'development', provider: config.updates.provider }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const identity = JSON.parse(await readFile(join(process.argv[2], 'assembly.json'), 'utf8'))
  const errors = []
  const config = parse(await readFile(process.argv[3], 'utf8'), errors)
  assert.deepEqual(errors, [], 'Invalid first-launch JSONC')
  console.log(JSON.stringify(verifyGenericFirstLaunch(identity, config)))
}
