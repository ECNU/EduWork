import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capture, isMainModule } from '../scripts/lib/build-util.mjs'

test('stdin imports do not require a filesystem entry point', () => {
  const original = process.argv[1]
  process.argv[1] = '-'
  try {
    assert.equal(isMainModule(import.meta.url), false)
  } finally {
    process.argv[1] = original
  }
})

test('a CLI invoked through a symlink still executes its main entry', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-script-entry-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const script = join(root, 'entry.mjs'), link = join(root, 'linked.mjs')
  const helper = new URL('../scripts/lib/build-util.mjs', import.meta.url).href
  await writeFile(script, `import { isMainModule } from ${JSON.stringify(helper)}\nconsole.log(isMainModule(import.meta.url))\n`)
  await symlink(script, link)
  assert.equal(await capture(process.execPath, [link]), 'true')
})
