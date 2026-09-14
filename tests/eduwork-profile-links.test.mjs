import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const linker = fileURLToPath(new URL('../scripts/link-studio-web-profile.ps1', import.meta.url))
const scopes = ['@deepseek-ai', '@chatecnu-work', '@eduwork', '@shlv']
const commit = '183f08e9c6dde7e36cd2318eaee70b0da08fb35e'
const json = (path, value) => writeFile(path, JSON.stringify(value))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'eduwork links 中文 '))
  const home = join(root, 'home'), modules = join(home, 'profiles/test/node_modules')
  const assemblies = [join(root, 'assembly one'), join(root, 'assembly two')]
  for (const assembly of assemblies) {
    for (const scope of scopes) {
      const target = join(assembly, 'd/node_modules', scope)
      await mkdir(target, { recursive: true })
      await writeFile(join(target, 'sentinel.txt'), assembly)
    }
    await json(join(assembly, 'assembly.json'), { kind: 'eduwork-web', dshCommit: commit, dshVersion: '0.1.5-rc.1' })
    await json(join(assembly, 'd/.chatecnu-dsh-runtime.json'), { dshCommit: commit, dshVersion: '0.1.5-rc.1' })
  }
  const config = join(root, 'private.json')
  return { root, home, modules, assemblies, config,
    async run(assembly) {
      await json(config, { assembly, home, profileName: 'test' })
      return execFileSync('pwsh', ['-NoProfile', '-File', linker, '-Config', config], { windowsHide: true, encoding: 'utf8', stdio: 'pipe' })
    },
  }
}

test('managed Web links switch assemblies while preserving both package trees', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture()
  try {
    await f.run(f.assemblies[0])
    await f.run(f.assemblies[0])
    await f.run(f.assemblies[1])
    for (const scope of scopes) {
      assert.equal(await realpath(join(f.modules, scope)), await realpath(join(f.assemblies[1], 'd/node_modules', scope)))
      for (const assembly of f.assemblies) assert.equal(await readFile(join(assembly, 'd/node_modules', scope, 'sentinel.txt'), 'utf8'), assembly)
    }
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('pre-receipt assembly links can be adopted, but ordinary package directories are preserved', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture()
  try {
    await mkdir(f.modules, { recursive: true })
    for (const scope of scopes) await symlink(join(f.assemblies[0], 'd/node_modules', scope), join(f.modules, scope), 'junction')
    await f.run(f.assemblies[1])
    // Replacing a scope with a real directory must reject before another scope
    // is switched, and must not remove that directory or its contents.
    await rm(join(f.modules, '@eduwork'))
    await mkdir(join(f.modules, '@eduwork'))
    await writeFile(join(f.modules, '@eduwork', 'keep.txt'), 'user package')
    await assert.rejects(() => f.run(f.assemblies[0]), /Unexpected profile module entry/)
    assert.equal(await readFile(join(f.modules, '@eduwork', 'keep.txt'), 'utf8'), 'user package')
    assert.equal(await realpath(join(f.modules, '@deepseek-ai')), await realpath(join(f.assemblies[1], 'd/node_modules/@deepseek-ai')))
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
