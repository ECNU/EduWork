import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fixture } from '../test/helpers/desktop-fixture.js'

const fileIndex = process.argv.indexOf('--config')
if (fileIndex < 0 || !process.argv[fileIndex + 1]) throw new Error('Usage: node scripts/serve-desktop-oidc-fixture.mjs --config <new test JSONC file>')
const configFile = resolve(process.argv[fileIndex + 1])
const cleanup = []
const server = await fixture({ after: action => cleanup.push(action) }, { resources: true })
await mkdir(dirname(configFile), { recursive: true })
// Exclusive creation: never overwrite an active user's enterprise configuration.
await writeFile(configFile, JSON.stringify({ schemaVersion: 1, product: { name: 'EduWork OIDC Test' }, organizations: [server.rawProfile], desktop: { closeAction: 'exit' } }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ ready: true, configFile, issuer: server.origin, identity: 'Synthetic user', model: 'fixture-ai/fixture-model' }))
let closing = false
async function stop() { if (closing) return; closing = true; for (const action of cleanup.reverse()) await action(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
