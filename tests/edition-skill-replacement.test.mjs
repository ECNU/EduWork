import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { childPath, readJSON } from '../scripts/lib/build-util.mjs'

// Exercise the assembler's actual configuration boundary without installing a
// Runtime or contacting services. The complete product build is a separate check.
const source = await readFile(new URL('../scripts/assemble-eduwork-web.mjs', import.meta.url), 'utf8')
function block(from, until) {
  const start = source.indexOf(from), end = source.indexOf(until, start)
  assert.ok(start >= 0 && end > start, 'Assembler configuration boundary must remain identifiable')
  return source.slice(start, end)
}
const configure = new Function('readJSON', 'childPath', 'coreRoot', 'editionRoot', 'distributionConfig',
  'return (async () => {\n'
  + block('  const selected = await readJSON(', '  if (!assemblyConfig)')
  + block('  const skillNames = new Set()', '  const skills = []')
  + '\nreturn distribution;\n})()')

const baseSkills = [
  { name: 'browser', source: 'skills/core-browser', defaultEnabled: true },
  { name: 'artifact-images', source: 'skills/core-images', defaultEnabled: true },
  { name: 'retained', source: 'skills/core-retained', defaultEnabled: true },
]
async function fixture(t, skills, coreSkills = baseSkills) {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-edition-skills-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const core = join(root, 'core'), edition = join(root, 'edition')
  await mkdir(join(core, 'config'), { recursive: true })
  await mkdir(edition)
  await writeFile(join(core, 'config/base.json'), JSON.stringify({ schemaVersion: 1, capabilities: { images: true }, skills: coreSkills }))
  await writeFile(join(edition, 'distribution.json'), JSON.stringify({ schemaVersion: 1, coreBase: 'config/base.json', skills }))
  return () => configure(readJSON, childPath, core, edition, 'distribution.json')
}

test('declared edition replacements keep one name, new binding and unrelated core skills', async t => {
  const replacements = baseSkills.slice(0, 2).map(skill => ({
    name: skill.name, root: 'edition', source: `skills/edition-${skill.name}`, replace: true,
    defaultEnabled: false, metadata: { service: 'synthetic-service' },
  }))
  const run = await fixture(t, replacements)
  const distribution = await run()
  assert.deepEqual(distribution.skills, [baseSkills[2], ...replacements])
  assert.equal(new Set(distribution.skills.map(skill => skill.name)).size, distribution.skills.length)
})

test('an undeclared duplicate still fails instead of silently replacing a core skill', async t => {
  const run = await fixture(t, [{ name: 'browser', root: 'edition', source: 'skills/edition-browser' }])
  await assert.rejects(run(), /Duplicate user-facing Skill: browser/)
})

test('a distinct edition skill preserves the existing core skill set', async t => {
  const extra = { name: 'edition-extra', root: 'edition', source: 'skills/extra' }
  const run = await fixture(t, [extra])
  assert.deepEqual((await run()).skills, [...baseSkills, extra])
})

test('replacement of a missing core skill is rejected', async t => {
  const run = await fixture(t, [{ name: 'missing', root: 'edition', source: 'skills/missing', replace: true }])
  await assert.rejects(run(), /Skill replacement must select one core skill: missing/)
})

test('replacement of an ambiguous core name is rejected', async t => {
  const run = await fixture(t, [{ name: 'browser', replace: true }], [...baseSkills, { name: 'browser', source: 'skills/second-browser' }])
  await assert.rejects(run(), /Skill replacement must select one core skill: browser/)
})

test('two edition replacements cannot both claim the same core skill', async t => {
  const run = await fixture(t, [{ name: 'browser', replace: true }, { name: 'browser', replace: true }])
  await assert.rejects(run(), /Skill replacement must select one core skill: browser/)
})
