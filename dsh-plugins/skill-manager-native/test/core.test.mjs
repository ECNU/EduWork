import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PersonalSkillStore, SkillStoreError } from '../lib/core.js'

const skill = (name, description = '测试技能') => `---\nname: ${name}\ndescription: ${description}\n---\n\n完成用户要求。\n`

test('creates and lists a standard personal skill without a session', async () => {
  const home = await mkdtemp(join(tmpdir(), 'chatecnu-skill-create-'))
  const store = new PersonalSkillStore(home)
  const created = await store.create({ name: 'meeting-helper', description: '整理会议材料', instructions: '先读取材料，再输出摘要。' })
  assert.equal(created.name, 'meeting-helper')
  assert.match(await readFile(join(home, 'skills/meeting-helper/SKILL.md'), 'utf8'), /先读取材料/u)
  assert.deepEqual((await store.list()).skills.map(item => item.name), ['meeting-helper'])
})

test('imports one bounded directory bundle atomically with resources', async () => {
  const home = await mkdtemp(join(tmpdir(), 'chatecnu-skill-import-home-'))
  const source = await mkdtemp(join(tmpdir(), 'chatecnu-skill-import-source-'))
  await writeFile(join(source, 'SKILL.md'), skill('campus-report'), 'utf8')
  await mkdir(join(source, 'references'))
  await writeFile(join(source, 'references/schema.md'), '# Schema\n', 'utf8')
  const store = new PersonalSkillStore(home)
  await store.importDirectory(source)
  assert.equal(await readFile(join(home, 'skills/campus-report/references/schema.md'), 'utf8'), '# Schema\n')
})

test('rejects duplicate names and symlink-bearing bundles', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'chatecnu-skill-reject-home-'))
  const store = new PersonalSkillStore(home)
  await store.create({ name: 'safe-skill', description: '安全技能', instructions: '执行任务。' })
  await assert.rejects(
    store.create({ name: 'safe-skill', description: '重复技能', instructions: '执行任务。' }),
    error => error instanceof SkillStoreError && error.code === 'skill_exists',
  )

  const source = await mkdtemp(join(tmpdir(), 'chatecnu-skill-reject-source-'))
  await writeFile(join(source, 'SKILL.md'), skill('linked-skill'), 'utf8')
  try {
    await symlink(join(source, 'SKILL.md'), join(source, 'linked.md'))
  } catch (error) {
    if (error?.code === 'EPERM') return t.skip('当前 Windows 账户不能创建测试符号链接')
    throw error
  }
  await assert.rejects(
    store.importDirectory(source),
    error => error instanceof SkillStoreError && error.code === 'skill_bundle_symlink',
  )
})

test('rejects malformed or non-standard skill definitions', async () => {
  const home = await mkdtemp(join(tmpdir(), 'chatecnu-skill-invalid-home-'))
  const source = await mkdtemp(join(tmpdir(), 'chatecnu-skill-invalid-source-'))
  await writeFile(join(source, 'SKILL.md'), '---\nname: Bad Name\ndescription: bad\n---\n\nBody\n', 'utf8')
  await assert.rejects(new PersonalSkillStore(home).importDirectory(source), /小写字母/u)
})

test('removes only a named personal skill into recoverable trash', async () => {
  const home = await mkdtemp(join(tmpdir(), 'chatecnu-skill-remove-'))
  const store = new PersonalSkillStore(home)
  await store.create({ name: 'meeting-helper', description: '整理会议材料', instructions: '先读取材料。' })
  const removed = await store.remove('meeting-helper')

  assert.equal(removed.name, 'meeting-helper')
  assert.deepEqual((await store.list()).skills, [])
  const trash = await readdir(join(home, '.skill-trash'))
  assert.equal(trash.length, 1)
  assert.match(trash[0], /^meeting-helper-\d+-/u)
  assert.match(await readFile(join(home, '.skill-trash', trash[0], 'SKILL.md'), 'utf8'), /整理会议材料/u)

  await store.create({ name: 'meeting-helper', description: '重新创建', instructions: '重新执行。' })
  assert.deepEqual((await store.list()).skills.map(item => item.name), ['meeting-helper'])
})

test('removes a legacy root markdown skill by declared name without accepting paths', async () => {
  const home = await mkdtemp(join(tmpdir(), 'chatecnu-skill-remove-file-'))
  await mkdir(join(home, 'skills'))
  await writeFile(join(home, 'skills', 'legacy-file.md'), skill('legacy-helper'), 'utf8')
  const store = new PersonalSkillStore(home)

  await store.remove('legacy-helper')
  assert.deepEqual((await store.list()).skills, [])
  await assert.rejects(store.remove('../legacy-helper'), error => (
    error instanceof SkillStoreError && error.code === 'skill_name_invalid'
  ))
  await assert.rejects(store.remove('missing-helper'), error => (
    error instanceof SkillStoreError && error.code === 'skill_not_found'
  ))
})
