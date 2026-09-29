// Parallel sets are derived from the declared edges, never hand-written, so
// they cannot drift from the graph the runner actually uses. These tests pin
// the derivation and the concurrency default that depends on it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Workspace, maxParallelism, parallelSets, runStages, stage,
} from '../scripts/lib/stage-runner.mjs'

const quiet = () => {}

async function sandbox(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  return {
    root,
    workspace: join(root, 'build'),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

/** A stage that writes `<name>.txt` so the runner has a real artifact to record. */
function simple(name, extras = {}) {
  return stage({
    name,
    outputs: [`${name}.txt`],
    run: async workspace => { await writeFile(join(workspace.root, `${name}.txt`), name) },
    ...extras,
  })
}

test('independent stages form a single wave', () => {
  const stages = [simple('a'), simple('b'), simple('c')]
  assert.deepEqual(parallelSets(stages), [['a', 'b', 'c']])
  assert.equal(maxParallelism(stages), 3)
})

test('a chain is one stage per wave', () => {
  const stages = [
    simple('a'),
    simple('b', { requires: ['a'] }),
    simple('c', { requires: ['b'] }),
  ]
  assert.deepEqual(parallelSets(stages), [['a'], ['b'], ['c']])
  assert.equal(maxParallelism(stages), 1)
})

test('a diamond puts both middle stages in one wave', () => {
  const stages = [
    simple('root'),
    simple('left', { requires: ['root'] }),
    simple('right', { requires: ['root'] }),
    simple('join', { requires: ['left', 'right'] }),
  ]
  assert.deepEqual(parallelSets(stages), [['root'], ['left', 'right'], ['join']])
  assert.equal(maxParallelism(stages), 2)
})

test('an unhashed ordering edge still pushes a stage into a later wave', () => {
  // `dependsOn` carries no digest, but it is still an ordering constraint.
  const stages = [simple('a'), simple('b', { dependsOn: ['a'] })]
  assert.deepEqual(parallelSets(stages), [['a'], ['b']])
})

test('a cycle terminates instead of recursing forever', () => {
  const stages = [
    simple('a', { requires: ['b'] }),
    simple('b', { requires: ['a'] }),
  ]
  // The graph builder rejects this before a run starts; the helper is still
  // called on its own, so it must return rather than overflow the stack.
  assert.equal(Array.isArray(parallelSets(stages)), true)
  assert.ok(maxParallelism(stages) >= 1)
})

test('the derived width is what actually overlaps when used as the job count', async () => {
  const { workspace, cleanup } = await sandbox('eduwork-parallel-width-')
  try {
    const events = []
    const names = ['a', 'b', 'c', 'd']
    const stages = names.map(name => stage({
      name,
      outputs: [`${name}.txt`],
      run: async ws => {
        events.push(`start:${name}`)
        await new Promise(resolve => setTimeout(resolve, 30))
        await writeFile(join(ws.root, `${name}.txt`), name)
        events.push(`end:${name}`)
      },
    }))
    assert.equal(maxParallelism(stages), names.length)

    const ws = new Workspace({ root: workspace, parameters: {}, stages })
    await ws.enter()
    await runStages(ws, { jobs: maxParallelism(stages), log: quiet })

    // With one slot per stage, every stage must start before any of them ends.
    for (const name of names) assert.ok(events.includes(`start:${name}`), `${name} never ran`)
    const firstEnd = events.findIndex(event => event.startsWith('end:'))
    const startedBeforeFirstEnd = events.slice(0, firstEnd).filter(event => event.startsWith('start:')).length
    assert.equal(startedBeforeFirstEnd, names.length, `only ${startedBeforeFirstEnd} stages overlapped`)
    for (const name of names) assert.equal(await readFile(join(ws.root, `${name}.txt`), 'utf8'), name)
  } finally { await cleanup() }
})

test('one worker runs the same stages strictly in sequence', async () => {
  const { workspace, cleanup } = await sandbox('eduwork-parallel-serial-')
  try {
    const events = []
    const names = ['a', 'b', 'c', 'd']
    const stages = names.map(name => stage({
      name,
      outputs: [`${name}.txt`],
      run: async ws => {
        events.push(`start:${name}`)
        await new Promise(resolve => setTimeout(resolve, 10))
        await writeFile(join(ws.root, `${name}.txt`), name)
        events.push(`end:${name}`)
      },
    }))
    const ws = new Workspace({ root: workspace, parameters: {}, stages })
    await ws.enter()
    await runStages(ws, { jobs: 1, log: quiet })

    // Serial means every start is immediately followed by its own end.
    assert.deepEqual(events, names.flatMap(name => [`start:${name}`, `end:${name}`]))
  } finally { await cleanup() }
})
