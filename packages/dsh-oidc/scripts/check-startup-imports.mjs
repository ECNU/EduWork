import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const loaded = []
const hooks = registerHooks({
  load(url, context, nextLoad) {
    loaded.push(url)
    return nextLoad(url, context)
  },
})
try {
  await import('../lib/provider/index.js')
} finally {
  hooks.deregister()
}
assert.equal(loaded.some(url => url.includes('/node_modules/typebox/')), false,
  'provider entry must not load TypeBox at startup')
