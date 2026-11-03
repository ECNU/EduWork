import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, parse } from 'node:path'
import { tmpdir } from 'node:os'
import { keepsExternalWorkspace } from '../lib/data-import.js'

test('an imported workspace outside the program root stays unless it is a disk root or a data directory', () => {
  const base = join(tmpdir(), 'eduwork-external-workspace'), home = join(base, 'new-home'), old = join(base, 'old', 'data', 'dsh')
  assert.equal(keepsExternalWorkspace(join(base, 'projects', 'thesis'), [home, old]), true)
  assert.equal(keepsExternalWorkspace(base, [home, old]), true, 'a parent of the data directories is an ordinary folder')
  assert.equal(keepsExternalWorkspace(parse(base).root, [home, old]), false)
  assert.equal(keepsExternalWorkspace(home, [home, old]), false)
  assert.equal(keepsExternalWorkspace(join(home, 'sessions'), [home, old]), false)
  assert.equal(keepsExternalWorkspace(join(old, 'attachments'), [home, old]), false)
})
