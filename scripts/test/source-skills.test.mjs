import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, access } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { copySourceSkills } from '../copy-source-skills.mjs'
import { copyProductTree } from '../portable-product-links.mjs'
import { writeBundledSkillsManifest } from '../write-bundled-skills-manifest.mjs'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const sharedSource = join(repository, 'packages/dsh-knowledge-studio/packages/artifact-services/skills')
const distribution = JSON.parse(await readFile(join(repository, 'config/distributions/generic.json'), 'utf8'))
const skills = distribution.skills.filter(skill => skill.sourcePackage === '@eduwork/dsh-artifact-services')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-source-skills-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const packages = join(root, 'packages'), source = join(packages, '@eduwork/dsh-artifact-services/skills')
  await copyProductTree(sharedSource, source)
  return { root, packages, source }
}

test('projected creation skills retain every shared reference after product relocation', async t => {
  const { root, packages } = await fixture(t)
  const product = join(root, 'product'), relocated = join(root, 'relocated product')
  await copySourceSkills({ repository, packages, skills, output: join(product, 'skills') })
  await rename(product, relocated)
  let references = 0
  for (const skill of skills) {
    const entry = join(relocated, 'skills', skill.name, 'SKILL.md')
    const body = await readFile(entry, 'utf8')
    for (const [, target] of body.matchAll(/\]\((\.\.\/shared\/[^)]+)\)/g)) {
      const actual = await readFile(resolve(dirname(entry), target), 'utf8')
      assert.equal(actual, await readFile(resolve(sharedSource, skill.sourcePath.slice('skills/'.length), target), 'utf8'))
      references++
    }
  }
  assert.ok(references >= 10, 'the five creation skills must keep their shared guidance links')
  const manifest = await writeBundledSkillsManifest({ root, product: relocated, output: join(root, 'bundled-skills.json') })
  assert.ok(manifest.files.some(file => file.path.endsWith('/skills/shared/references/common.md')))
  assert.ok(!manifest.files.some(file => /\/shared\/.*SKILL\.md$/.test(file.path)))
})

test('source skill projection fails when selected artifact skills lack their shared directory', async t => {
  const { root, packages, source } = await fixture(t)
  await rm(join(source, 'shared'), { recursive: true })
  await assert.rejects(copySourceSkills({ repository, packages, skills, output: join(root, 'output') }), { code: 'ENOENT' })
})

test('repository-only skills do not require artifact service references', async t => {
  const { root, packages } = await fixture(t)
  const source = join(root, 'repository/sample')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'SKILL.md'), '# Synthetic skill\n')
  const output = join(root, 'output')
  await copySourceSkills({ repository: join(root, 'repository'), packages, skills: [{ name: 'sample', source: 'sample' }], output })
  assert.equal(await readFile(join(output, 'sample/SKILL.md'), 'utf8'), '# Synthetic skill\n')
  await assert.rejects(access(join(output, 'shared')), { code: 'ENOENT' })
})
