import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capture, isMainModule } from '../scripts/lib/build-util.mjs'
import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../', import.meta.url))

for (const platform of ['windows', 'macos']) {
  test(`${platform} legacy npm CLI rejects before checking sources or creating output`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'eduwork-retired-recipe-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const output = join(root, 'output')
    const result = spawnSync(process.execPath, [join(repository, `scripts/ci-eduwork-${platform}-release.mjs`),
      '--core-root', join(root, 'missing-core'), '--edition-root', join(root, 'missing-edition'),
      '--distribution-config', 'missing.json', '--version', '0.4.6-dev.20261021.1',
      '--output', output, '--development', '--recipe', 'npm'], { encoding: 'utf8', windowsHide: true })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /legacy --recipe npm desktop build is retired/)
    assert.match(result.stderr, /npm Runtime and plugin assembly remain supported/)
    await assert.rejects(access(output), { code: 'ENOENT' })
  })

  test(`${platform} legacy PowerShell entry reports migration without building`, { skip: process.platform !== 'win32' }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'eduwork-retired-ps1-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const output = join(root, 'output')
    const result = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-File',
      join(repository, `scripts/ci-eduwork-${platform}-release.ps1`),
      '-CoreRoot', join(root, 'missing-core'), '-EditionRoot', join(root, 'missing-edition'),
      '-Version', '0.4.6', '-Output', output], { encoding: 'utf8', windowsHide: true, env: { ...process.env, NO_COLOR: '1' } })
    assert.equal(result.status, 1, result.error?.message ?? result.stderr)
    assert.match(result.stderr, /PowerShell desktop recipe is retired/)
    assert.match(result.stderr, new RegExp(`ci-eduwork-${platform}-release\\.mjs`))
    await assert.rejects(access(output), { code: 'ENOENT' })
  })
}

test('legacy Electron shell entry rejects before reading the upstream or prepared Host', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-retired-shell-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const output = join(root, 'output')
  const result = spawnSync(process.execPath, [join(repository, 'dsh-electron/scripts/build-shell.mjs'),
    '--upstream', join(root, 'missing-upstream'), '--host', join(root, 'missing-host'), '--output', output],
  { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /legacy Electron shell build is retired/)
  assert.match(result.stderr, /--pinned-dsh-source with --runtime/)
  await assert.rejects(access(output), { code: 'ENOENT' })
})

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
