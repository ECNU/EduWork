import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Connections} from '../src/connections.js'

const entry = id => ({id, name: id, kind: 'acp', command: process.execPath, args: [], enabled: false})
function manager(entries = []) {
  const data = new Map(entries.map(row => [row.id, row]))
  const table = {entries: () => data.entries(), async put(id, value) {data.set(id, value)}, async delete(id) {data.delete(id)}}
  const service = Object.assign(Object.create(Connections.prototype), {
    active: new Map(), checks: new Map(), queue: Promise.resolve(), ready: Promise.resolve(), table,
    async rows() { return [...data.values()].map(row => ({...row, checked: this.checks.get(row.id)?.ok ?? false})) },
  })
  return {service, data, table}
}

test('failed restoration does not block other entries or disabling/removing the failure', async () => {
  const bad = {...entry('acp_bad'), enabled: true}, good = {...entry('acp_good'), enabled: true}
  const {service, table, data} = manager([bad, good])
  service.ctx = {storageDomain: {async open() {return {table: () => table}}}}
  service.activate = async row => {if (row.id === bad.id) throw Error('duplicate provider'); service.active.set(row.id, [])}
  await service.open()
  assert.equal(service.checks.get(bad.id).message, 'activation_failed')
  assert.ok(service.active.has(good.id))
  await service.manage({op: 'enable', id: bad.id, enabled: false})
  await service.manage({op: 'remove', id: bad.id})
  assert.equal(data.has(bad.id), false)
  assert.equal(data.get(good.id).enabled, true)
})

test('enabling requires explicit successful check; failed persistence disposes new registrations', async () => {
  const row = entry('acp_example'), {service, table, data} = manager([row])
  let disposed = 0, activated = 0
  service.activate = async value => {activated++; service.active.set(value.id, [{async dispose() {disposed++}}])}
  await assert.rejects(service.manage({op: 'enable', id: row.id, enabled: true}), /check_first/)
  assert.equal(activated, 0)
  service.checks.set(row.id, {ok: true})
  table.put = async () => {throw Error('disk full')}
  await assert.rejects(service.manage({op: 'enable', id: row.id, enabled: true}), /disk full/)
  assert.equal(disposed, 1)
  assert.equal(service.active.has(row.id), false)
  assert.equal(data.get(row.id).enabled, false)
  assert.equal((await service.manage({op: 'list'})).rows.length, 1)
})

test('failed tool registration rolls back provider registration', async () => {
  const {service} = manager()
  const disposed = [], mounted = []
  service.ownerContext = {plugin(_plugin, config) {
    const i = mounted.length; mounted.push(config)
    const fiber = i ? Promise.reject(Error('tool conflict')) : Promise.resolve()
    fiber.dispose = async () => {disposed.push(i)}
    return fiber
  }}
  await assert.rejects(service.activate(entry('acp_example')), /tool conflict/)
  assert.deepEqual(disposed, [1, 0])
  assert.equal(mounted[0].permission, 'reject')
  assert.equal(mounted[1].provider, 'eduwork_acp_example')
  assert.equal(service.active.size, 0)
})

test('disable failure to persist restores registrations; queue remains usable', async () => {
  const row = {...entry('acp_example'), enabled: true}, {service, table} = manager([row])
  let disposed = 0, restored = 0
  service.active.set(row.id, [{async dispose() {disposed++}}])
  service.activate = async () => {restored++}
  table.put = async () => {throw Error('disk full')}
  await assert.rejects(service.manage({op: 'enable', id: row.id, enabled: false}), /disk full/)
  assert.equal(disposed, 1)
  assert.equal(restored, 1)
  assert.equal((await service.manage({op: 'list'})).rows[0].enabled, true)
})

test('a check cannot authorize enabling when saving its executable fails', async () => {
  const row = {...entry('codex'), kind: 'codex'}, {service, table} = manager([row])
  service.ctx = {subprocess: {spawn: () => ({done: Promise.resolve({exitCode: 0}), terminate() {}, async waitForExit() {}})}}
  service.checks.set(row.id, {ok: true})
  table.put = async () => {throw Error('disk full')}
  await assert.rejects(service.manage({op: 'check', id: row.id}), /disk full/)
  assert.equal(service.checks.has(row.id), false)
  await assert.rejects(service.manage({op: 'enable', id: row.id, enabled: true}), /check_first/)
})

test('saved native ACP connections retain their command, arguments and enabled state on rescan', async () => {
  const saved = ['opencode', 'kimi'].map(id => ({...entry(id), args: ['saved-argument'], enabled: true}))
  const {service} = manager(saved)
  const rows = await Connections.prototype.rows.call(service)
  for (const expected of saved) {
    const matches = rows.filter(row => row.id === expected.id)
    assert.equal(matches.length, 1)
    assert.equal(matches[0].command, expected.command)
    assert.deepEqual(matches[0].args, expected.args)
    assert.equal(matches[0].enabled, true)
    assert.equal(matches[0].checked, false)
  }
})

test('saving a manual ACP connection never starts or enables it', async () => {
  const {service, data} = manager()
  service.ctx = {subprocess: {spawn() {assert.fail('saving must be passive')}}}
  service.activate = async () => assert.fail('saving must not activate')
  await service.manage({op: 'add', name: 'Synthetic ACP', command: process.execPath, args: ['acp']})
  assert.equal(data.size, 1)
  assert.equal([...data.values()][0].enabled, false)
  assert.equal(service.checks.size, 0)
})
