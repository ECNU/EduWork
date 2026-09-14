import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  decodeImportFile, importGrantedWorkspaceFiles, importWorkspaceFiles, safeImportName, WORKSPACE_IMPORT_DIRECTORY,
} from '../lib/workspace-import.js'

const encoded = value => ({
  name: value.name,
  mediaType: value.mediaType ?? 'application/octet-stream',
  bytes: value.data.byteLength,
  data: value.data.toString('base64'),
})

test('workspace import sanitizes names, preserves bytes and never overwrites collisions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'chatecnu-import-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = await importWorkspaceFiles(root, [encoded({ name: '../报告?.pdf', data: Buffer.from('one') })])
  const second = await importWorkspaceFiles(root, [encoded({ name: '../报告?.pdf', data: Buffer.from('two') })])
  assert.deepEqual(first, [{ path: `${WORKSPACE_IMPORT_DIRECTORY}/报告_.pdf`, name: '报告_.pdf', bytes: 3 }])
  assert.equal(second[0].name, '报告_ (2).pdf')
  assert.equal(await readFile(join(root, ...first[0].path.split('/')), 'utf8'), 'one')
  assert.equal(await readFile(join(root, ...second[0].path.split('/')), 'utf8'), 'two')
})

test('workspace import rejects malformed payloads before publishing files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'chatecnu-import-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.throws(() => decodeImportFile({ name: 'x.bin', bytes: 2, data: 'YQ==' }), /长度校验失败/u)
  await assert.rejects(importWorkspaceFiles(root, [encoded({ name: 'ok.txt', data: Buffer.from('ok') }), { name: 'bad', bytes: 1, data: '%' }]), /Base64/u)
  await assert.rejects(readFile(join(root, '.chatecnu', 'attachments', 'ok.txt')), /ENOENT/u)
})

test('workspace import refuses a symlinked attachment directory outside the workspace', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'chatecnu-import-'))
  const outside = await mkdtemp(join(tmpdir(), 'chatecnu-import-outside-'))
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]))
  await mkdir(join(root, '.chatecnu'), { recursive: true })
  await symlink(outside, join(root, '.chatecnu', 'attachments'), 'junction')
  await assert.rejects(importWorkspaceFiles(root, [encoded({ name: 'escape.txt', data: Buffer.from('no') })]), /普通目录|工作区外部/u)
})

test('safe import names cover Windows reserved names and unrepresentable punctuation', () => {
  assert.equal(safeImportName('CON.txt'), '_CON.txt')
  assert.equal(safeImportName('a<b>:c?.docx'), 'a_b__c_.docx')
})

test('desktop grant import copies bytes once and consumes the opaque grant', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'chatecnu-import-'))
  const intake = await mkdtemp(join(tmpdir(), 'chatecnu-native-intake-'))
  const grant = 'a'.repeat(32)
  const grantRoot = join(intake, grant)
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(intake, { recursive: true, force: true })]))
  await mkdir(grantRoot)
  await writeFile(join(grantRoot, 'M890材料.docx'), Buffer.from('native-office-payload'))
  const result = await importGrantedWorkspaceFiles(root, intake, grant)
  assert.equal(result[0].path, `${WORKSPACE_IMPORT_DIRECTORY}/M890材料.docx`)
  assert.equal(await readFile(join(root, ...result[0].path.split('/')), 'utf8'), 'native-office-payload')
  await assert.rejects(readFile(join(grantRoot, 'M890材料.docx')), /ENOENT/u)
})

test('desktop grant import rejects guessed or malformed grants', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'chatecnu-import-'))
  const intake = await mkdtemp(join(tmpdir(), 'chatecnu-native-intake-'))
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(intake, { recursive: true, force: true })]))
  await assert.rejects(importGrantedWorkspaceFiles(root, intake, '../escape'), /授权无效/u)
})

test('desktop grant imports an external regression fixture without JSON encoding', {
  skip: process.env.CHATECNU_WORK_FILE_INTAKE_FIXTURE === undefined,
}, async (t) => {
  const source = process.env.CHATECNU_WORK_FILE_INTAKE_FIXTURE
  const root = await mkdtemp(join(tmpdir(), 'chatecnu-import-'))
  const intake = await mkdtemp(join(tmpdir(), 'chatecnu-native-intake-'))
  const grant = 'b'.repeat(32)
  const grantRoot = join(intake, grant)
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(intake, { recursive: true, force: true })]))
  await mkdir(grantRoot)
  await copyFile(source, join(grantRoot, 'M890材料.docx'))
  const result = await importGrantedWorkspaceFiles(root, intake, grant)
  const imported = join(root, ...result[0].path.split('/'))
  const digest = value => createHash('sha256').update(value).digest('hex')
  assert.equal(digest(await readFile(imported)), digest(await readFile(source)))
})
