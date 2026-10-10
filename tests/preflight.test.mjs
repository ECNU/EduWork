// The preflight exists to turn a failure that would happen minutes in — after
// downloads and compiles — into one that happens immediately. These tests pin
// the two checks that encode a real incident: the upstream cache shape and the
// tool probe.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preflight, scanUpstreamCache } from '../scripts/lib/preflight.mjs'

async function sandbox(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

/** Build a pnpm-style virtual store. `complete` decides which packages get a manifest. */
async function fakeVirtualStore(upstream, { complete = true } = {}) {
  const store = join(upstream, 'node_modules/.pnpm')
  await mkdir(store, { recursive: true })
  for (const [entry, name] of [['tsdown@0.22.2', 'tsdown'], ['lightningcss@1.32.0', 'lightningcss'], ['typescript@6.0.3', 'typescript']]) {
    const packageRoot = join(store, entry, 'node_modules', name)
    await mkdir(join(packageRoot, 'dist'), { recursive: true })
    await writeFile(join(packageRoot, 'dist/index.js'), 'built')
    if (complete) await writeFile(join(packageRoot, 'package.json'), '{"name":"' + name + '"}')
  }
}

test('an absent cache is reported as not installed, not as damage', async () => {
  const { root, cleanup } = await sandbox('pf-absent-')
  try {
    const result = await scanUpstreamCache(join(root, 'nothing'))
    assert.equal(result.present, false)
    assert.equal(result.reason, 'not installed')
  } finally { await cleanup() }
})

test('a complete virtual store is healthy', async () => {
  const { root, cleanup } = await sandbox('pf-healthy-')
  try {
    await fakeVirtualStore(root)
    const result = await scanUpstreamCache(root)
    assert.equal(result.healthy, true)
    assert.equal(result.totalPackages, 3)
    assert.equal(result.incompletePackages, 0)
  } finally { await cleanup() }
})

test('packages with build output but no manifest are detected', async () => {
  const { root, cleanup } = await sandbox('pf-damaged-')
  try {
    // This is the exact shape the damaged cache had: every package directory
    // present with its dist/, and every package.json gone.
    await fakeVirtualStore(root, { complete: false })
    const result = await scanUpstreamCache(root)
    assert.equal(result.present, true)
    assert.equal(result.healthy, false)
    assert.equal(result.totalPackages, 3)
    assert.equal(result.incompletePackages, 3)
    assert.match(result.reason, /3 of 3 packages have no package\.json/)
    assert.ok(result.samples.length > 0, 'a report without examples is not actionable')
  } finally { await cleanup() }
})

test('a store with no packages is not reported as healthy', async () => {
  const { root, cleanup } = await sandbox('pf-empty-store-')
  try {
    await mkdir(join(root, 'node_modules/.pnpm'), { recursive: true })
    const result = await scanUpstreamCache(root)
    assert.equal(result.healthy, false)
    assert.equal(result.reason, 'no packages resolved')
  } finally { await cleanup() }
})

test('a partial loss is still caught', async () => {
  const { root, cleanup } = await sandbox('pf-partial-')
  try {
    await fakeVirtualStore(root)
    // Remove exactly one manifest.
    await rm(join(root, 'node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/package.json'))
    const result = await scanUpstreamCache(root)
    assert.equal(result.healthy, false)
    assert.equal(result.incompletePackages, 1)
    assert.equal(result.totalPackages, 3)
  } finally { await cleanup() }
})

test('a missing tool is a problem and a present one is not', async () => {
  const { root, cleanup } = await sandbox('pf-tools-')
  try {
    const coreRoot = join(import.meta.dirname, '..')
    const result = await preflight({ coreRoot })
    // Every tool this platform needs must be reported, found or not.
    assert.ok(result.tools.length > 0, 'no tools were probed')
    for (const tool of result.tools) {
      assert.equal(typeof tool.present, 'boolean')
      if (!tool.present) assert.ok(result.problems.some(p => p.includes(tool.command)))
    }
    // A probe that exits non-zero is not a missing tool: `codesign --help` and
    // `ditto --help` both do that on a healthy macOS.
    for (const tool of result.tools) {
      assert.ok(!/exit code/.test(tool.error ?? ''), `${tool.command} was misreported as missing`)
    }
  } finally { await cleanup() }
})

test('missing required directories are reported', async () => {
  const { root, cleanup } = await sandbox('pf-dirs-')
  try {
    // An empty core root is missing every required directory.
    const result = await preflight({ coreRoot: root })
    assert.ok(result.missingDirectories.length > 0)
    assert.ok(result.problems.some(problem => problem.startsWith('Missing directory:')))
  } finally { await cleanup() }
})
