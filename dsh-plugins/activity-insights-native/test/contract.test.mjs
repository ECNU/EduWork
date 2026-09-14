import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')

test('plugin is removable, host-independent and read-only', async () => {
  const manifest = JSON.parse(await read('dsh-plugins/activity-insights-native/package.json'))
  assert.equal(manifest.name, '@chatecnu-work/dsh-activity-insights-native')
  assert.equal(manifest.chatecnuWork.kind, 'host-independent-native-plugin')
  assert.equal(manifest.chatecnuWork.removable, true)
  assert.match(manifest.chatecnuWork.storagePolicy, /readonly/)
  assert.doesNotMatch(JSON.stringify(manifest), /ecnu-max|api\.ecnu|client[_-]?id/i)
})

test('host uses public session observations and revision caching without returning conversation content', async () => {
  const [host, core, client] = await Promise.all([
    read('dsh-plugins/activity-insights-native/lib/index.js'),
    read('dsh-plugins/activity-insights-native/lib/core.js'),
    read('dsh-plugins/activity-insights-native/src/client/index.ts'),
  ])
  assert.match(host, /static inject = \['sessionQuery'\]/)
  assert.match(host, /sessionQuery|this\.query\.listSessions/)
  assert.match(host, /this\.query\.observeSession/)
  assert.match(host, /persistence\.listSnapshots/)
  assert.doesNotMatch(host, /persistence\.readFrom/)
  assert.match(host, /projectionMode: 'all'/)
  assert.match(host, /observation\.projections/)
  assert.match(core, /sessionStats/)
  assert.match(host, /Symbol\.dispose/)
  assert.doesNotMatch(host, /this\.query\.readSession/)
  assert.match(client, /withTimeout\(service\.snapshot/)
  assert.match(client, /service\.progress/)
  assert.match(client, /progressCount/)
  assert.match(core, /seedLength/)
  assert.match(core, /skillNameFromToolCall/)
  assert.match(core, /JSON\.parse\(data\.arguments\)/)
  assert.match(core, /tool\/call/)
  assert.match(client, /settings\.section.*activity-insights/s)
  assert.match(client, /Token 记录覆盖率/)
  assert.doesNotMatch(core, /event\.data\?\.content|header\.cwd/)
  assert.doesNotMatch(client, /overflowX:\s*'auto'|width:\s*'max-content'/)
})
