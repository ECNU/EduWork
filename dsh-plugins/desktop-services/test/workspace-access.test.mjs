import test from 'node:test'
import assert from 'node:assert/strict'
import { failedWorkspaceGrant, observeWorkspaceAccess } from '../lib/workspace-access.js'

const path = 'C:\\Projects\\synthetic'
const exec = { agent: { session: { header: { cwd: path } } } }
const error = target => ({ isError: true, error: { message: `SetNamedSecurityInfoW failed (Win32 5): grantWrite(${target})` } })
const policy = mode => ({ resolve: () => ({ mode, workspaceRoot: path }) })

test('only the real workspace grant failure qualifies, not successful use or an arbitrary access error', () => {
  const canonical = value => value
  assert.equal(failedWorkspaceGrant(exec, error(path), policy('workspace-write'), canonical), path)
  for (const result of [{}, { isError: false }, { isError: true, content: [{ text: error(path).error.message }] },
    error('C:\\Temp\\session-private'), { isError: true, error: { message: 'Access is denied' } },
    { isError: true, error: { message: error(path).error.message + '\nextra output' } }]) {
    assert.equal(failedWorkspaceGrant(exec, result, policy('workspace-write'), canonical), undefined)
  }
  for (const mode of ['read-only', 'full-access']) assert.equal(failedWorkspaceGrant(exec, error(path), policy(mode), canonical), undefined)
  assert.equal(failedWorkspaceGrant({}, error(path), policy('workspace-write'), canonical), undefined)
})

test('no startup scan; actual failures serialize, deduplicate, and stop after disposal', async () => {
  let listener, release
  const repairs = [], failures = [], controller = new AbortController()
  const settled = observeWorkspaceAccess({
    on: (event, callback) => { assert.equal(event, 'tools/result'); listener = callback },
    resolveWorkspace: async (_exec, result) => result.registeredPath,
    signal: controller.signal,
    repair: async target => { repairs.push(target); if (repairs.length === 1) await new Promise(resolve => { release = resolve }) },
    failed: error => failures.push(error),
  })
  await settled()
  assert.deepEqual(repairs, [])
  listener(exec, { registeredPath: path })
  listener(exec, { registeredPath: path.toLowerCase() })
  listener(exec, { registeredPath: 'D:\\second' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(repairs, [path])
  controller.abort(); release()
  await settled()
  assert.deepEqual(repairs, [path])
  assert.deepEqual(failures, [])
})
