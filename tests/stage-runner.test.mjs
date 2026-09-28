import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Workspace, digestPath, runStages, stage,
} from '../scripts/lib/stage-runner.mjs'

async function sandbox(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  return {
    root,
    workspace: join(root, 'build'),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

const quiet = () => {}

test('stages run in dependency order and independent stages overlap', async () => {
  const { workspace, cleanup } = await sandbox('eduwork-stages-order-')
  try {
    const events = []
    const work = (name, delay) => async () => {
      events.push(`start:${name}`)
      await new Promise(resolve => setTimeout(resolve, delay))
      events.push(`end:${name}`)
    }
    const stages = [
      stage({ name: 'a', outputs: ['a.txt'], run: async (ws) => { await work('a', 30)(); await writeFile(join(ws.root, 'a.txt'), 'a') } }),
      stage({ name: 'b', outputs: ['b.txt'], run: async (ws) => { await work('b', 30)(); await writeFile(join(ws.root, 'b.txt'), 'b') } }),
      stage({ name: 'c', requires: ['a', 'b'], outputs: ['c.txt'], run: async (ws) => { await work('c', 0)(); await writeFile(join(ws.root, 'c.txt'), `${await readFile(join(ws.root, 'a.txt'), 'utf8')}${await readFile(join(ws.root, 'b.txt'), 'utf8')}`) } }),
    ]
    const ws = new Workspace({ root: workspace, parameters: {}, stages })
    await ws.enter()
    await runStages(ws, { jobs: 2, log: quiet })

    for (const name of ['a', 'b', 'c']) assert.ok(events.includes(`start:${name}`), `${name} never ran`)
    // Two slots: the independent stages must be in flight together, and the
    // dependent one must not start until both of them finished.
    assert.ok(events.indexOf('start:b') < events.indexOf('end:a'), 'a and b did not overlap')
    assert.ok(events.indexOf('end:a') < events.indexOf('start:c'), 'c started before a finished')
    assert.ok(events.indexOf('end:b') < events.indexOf('start:c'), 'c started before b finished')
    assert.equal(await readFile(join(ws.root, 'c.txt'), 'utf8'), 'ab')
    assert.deepEqual(new Set(ws.executed), new Set(['a', 'b', 'c']))
  } finally { await cleanup() }
})

test('a rerun skips satisfied stages and reruns changed ones downstream', async () => {
  const { workspace, cleanup } = await sandbox('eduwork-stages-skip-')
  try {
    let version = 'one'
    const runs = []
    const stages = [
      stage({ name: 'source', outputs: ['source.txt'], inputs: () => ({ version }), run: async (ws) => { runs.push('source'); await writeFile(join(ws.root, 'source.txt'), version) } }),
      stage({ name: 'derived', requires: ['source'], outputs: ['derived.txt'], run: async (ws) => { runs.push('derived'); await writeFile(join(ws.root, 'derived.txt'), `${await readFile(join(ws.root, 'source.txt'), 'utf8')}!`) } }),
    ]
    const first = new Workspace({ root: workspace, parameters: {}, stages })
    await first.enter()
    await runStages(first, { log: quiet })
    assert.deepEqual(runs, ['source', 'derived'])

    const second = new Workspace({ root: workspace, parameters: {}, stages })
    const entry = await second.enter()
    assert.equal(entry.reused, true)
    await runStages(second, { log: quiet })
    assert.deepEqual(runs, ['source', 'derived'], 'nothing reran')
    assert.deepEqual(second.skipped.sort(), ['derived', 'source'])

    version = 'two'
    const third = new Workspace({ root: workspace, parameters: {}, stages })
    await third.enter()
    await runStages(third, { log: quiet })
    assert.deepEqual(runs, ['source', 'derived', 'source', 'derived'], 'the change propagated')
    assert.equal(await readFile(join(workspace, 'derived.txt'), 'utf8'), 'two!')
  } finally { await cleanup() }
})

test('a recorded artifact that vanished stops the run instead of being trusted', async () => {
  const { workspace, cleanup } = await sandbox('eduwork-stages-vanish-')
  try {
    const stages = [
      stage({ name: 'produce', outputs: ['artifact.bin'], run: async (ws) => { await writeFile(join(ws.root, 'artifact.bin'), 'payload') } }),
    ]
    const first = new Workspace({ root: workspace, parameters: {}, stages })
    await first.enter()
    await runStages(first, { log: quiet })

    await rm(join(workspace, 'artifact.bin'))
    const second = new Workspace({ root: workspace, parameters: {}, stages })
    await second.enter()
    await assert.rejects(() => runStages(second, { log: quiet }), (error) => {
      assert.equal(error.code, 'EDUWORK_VANISHED_ARTIFACT')
      return true
    })
  } finally { await cleanup() }
})

test('a recorded artifact modified underneath the checkpoint stops the run', async () => {
  const { workspace, cleanup } = await sandbox('eduwork-stages-modified-')
  try {
    const stages = [
      stage({ name: 'produce', outputs: ['artifact.bin'], run: async (ws) => { await writeFile(join(ws.root, 'artifact.bin'), 'payload') } }),
    ]
    const first = new Workspace({ root: workspace, parameters: {}, stages })
    await first.enter()
    await runStages(first, { log: quiet })

    await writeFile(join(workspace, 'artifact.bin'), 'tampered')
    const second = new Workspace({ root: workspace, parameters: {}, stages })
    await second.enter()
    await assert.rejects(() => runStages(second, { log: quiet }), (error) => {
      assert.equal(error.code, 'EDUWORK_MODIFIED_ARTIFACT')
      return true
    })
  } finally { await cleanup() }
})

test('a workspace without a checkpoint is not silently adopted', async () => {
  const { root, workspace, cleanup } = await sandbox('eduwork-stages-conflict-')
  try {
    await mkdir(workspace, { recursive: true })
    await writeFile(join(workspace, 'someone-elses-file.txt'), 'do not overwrite\n')
    const stages = [stage({ name: 'noop', run: async () => {} })]
    const guarded = new Workspace({ root: workspace, parameters: {}, stages })
    await assert.rejects(() => guarded.enter(), (error) => {
      assert.equal(error.code, 'EDUWORK_WORKSPACE_CONFLICT')
      return true
    })
    const adopted = new Workspace({ root: workspace, parameters: {}, stages })
    assert.equal((await adopted.enter({ force: true })).reused, false)
    assert.equal(await readFile(join(workspace, 'someone-elses-file.txt'), 'utf8'), 'do not overwrite\n')
    assert.ok(root)
  } finally { await cleanup() }
})

test('a checkpoint from different arguments is refused', async () => {
  const { workspace, cleanup } = await sandbox('eduwork-stages-arguments-')
  try {
    const stages = [stage({ name: 'noop', outputs: ['noop.txt'], run: async (ws) => { await writeFile(join(ws.root, 'noop.txt'), 'x') } })]
    const first = new Workspace({ root: workspace, parameters: { version: '1.0.0-dev.20260101.1' }, stages })
    await first.enter()
    await runStages(first, { log: quiet })

    const other = new Workspace({ root: workspace, parameters: { version: '1.0.0-dev.20260102.1' }, stages })
    await assert.rejects(() => other.enter(), /different pipeline arguments/)
  } finally { await cleanup() }
})

test('a dependency cycle is rejected before anything runs', async () => {
  const stages = [
    stage({ name: 'a', requires: ['b'], run: async () => {} }),
    stage({ name: 'b', requires: ['a'], run: async () => {} }),
  ]
  assert.throws(() => new Workspace({ root: '/nonexistent', parameters: {}, stages }), /dependency cycle/)
})

test('a failing stage does not leave its dependents reported as executed', async () => {
  const { workspace, cleanup } = await sandbox('eduwork-stages-failure-')
  try {
    const stages = [
      stage({ name: 'breaks', outputs: ['x'], run: async () => { throw new Error('synthetic failure') } }),
      stage({ name: 'after', requires: ['breaks'], outputs: ['y'], run: async (ws) => { await writeFile(join(ws.root, 'y'), 'y') } }),
    ]
    const ws = new Workspace({ root: workspace, parameters: {}, stages })
    await ws.enter()
    await assert.rejects(() => runStages(ws, { log: quiet }), /Stage breaks failed: synthetic failure/)
    assert.deepEqual(ws.executed, [])
  } finally { await cleanup() }
})

test('artifact digests are stable across repeated reads of a tree', async () => {
  const { root, cleanup } = await sandbox('eduwork-stages-digest-')
  try {
    const tree = join(root, 'tree')
    await mkdir(join(tree, 'nested'), { recursive: true })
    await writeFile(join(tree, 'b.txt'), 'b')
    await writeFile(join(tree, 'nested', 'a.txt'), 'a')
    const one = await digestPath(tree)
    const two = await digestPath(tree)
    assert.equal(one.sha256, two.sha256)
    assert.deepEqual(one.files.map(file => file.path), ['b.txt', 'nested/a.txt'])
    await writeFile(join(tree, 'nested', 'a.txt'), 'changed')
    assert.notEqual((await digestPath(tree)).sha256, one.sha256)
  } finally { await cleanup() }
})
