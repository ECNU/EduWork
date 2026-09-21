import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, mkdir, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { documentConfiguration } from '../configuration-documentation.mjs'
import { configurationFields } from '../configuration-reference.mjs'
import { ConfigurationFile, readConfiguration } from '../configuration-file.mjs'
import { parseUserConfig } from '../user-config.mjs'

test('comments in the editable JSONC cover the public enterprise schema, including optional nested fields', async () => {
  const schema = JSON.parse(await readFile(new URL('../../packages/dsh-oidc/schema/enterprise-profile.v1alpha1.schema.json', import.meta.url)))
  function visit(node, path) {
    if (node?.$ref) return visit(schema.$defs[node.$ref.split('/').at(-1)], path)
    for (const [key, field] of Object.entries(node.properties ?? {})) {
      if (field.deprecated) continue
      const target = path + '.' + key
      assert.ok(configurationFields[target]?.[0], 'Missing config help: ' + target)
      visit(field, target)
    }
    if (node.items) visit(node.items, path + '[]')
  }
  visit(schema, 'organizations[]')
  const text = documentConfiguration('{"schemaVersion":1,"organizations":[]}')
  for (const path of Object.keys(configurationFields)) assert.ok(text.includes('// ' + path + '：'), path)
  assert.deepEqual(parseUserConfig('/synthetic/config.jsonc', text).organizations, [])
})

test('comment refresh is idempotent for compact JSON, CRLF, BOM and user comments', () => {
  for (const text of [
    '{"schemaVersion":1,"organizations":[]}',
    '\uFEFF// My note\r\n{\r\n  "schemaVersion": 1, // inline note\r\n  /* another note */ "organizations": [],\r\n}\r\n',
  ]) {
    const once = documentConfiguration(text)
    assert.equal(documentConfiguration(once), once)
    assert.equal(once.split('// <eduwork-configuration-reference>').length, 2)
    for (const comment of ['// My note', '// inline note', '/* another note */']) if (text.includes(comment)) assert.ok(once.includes(comment))
    assert.equal(once.startsWith('\uFEFF'), text.startsWith('\uFEFF'))
  }
})

test('downloaded config and a later upgrade retain help, local choices and exactly one rollback backup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'documented-eduwork-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'config/eduwork.jsonc'), data = join(root, 'data')
  await mkdir(join(root, 'config'))
  const before = '// My UAT\n{"schemaVersion":1,"organizations":[],"features":{"maxConcurrentRequests":3}}'
  await writeFile(path, before)
  const file = await new ConfigurationFile(path, data).open()
  await file.document()
  assert.equal(await readFile(file.backup, 'utf8'), before)
  const original = await readFile(path, 'utf8')
  await file.document()
  assert.equal(await readFile(path, 'utf8'), original)
  assert.equal(await readFile(file.backup, 'utf8'), before, 'ordinary restart does not rotate the backup')
  const profile = { schemaVersion: 'dsh-oidc/v1alpha1', id: 'example', displayName: 'Example', auth: { discoveryUrl: 'https://example.test/discovery' } }
  await file.apply({ scope: 'a'.repeat(64), key: '1-' + 'b'.repeat(64), revision: 1, patch: { organizations: [profile] } })
  const applied = await readConfiguration(path)
  assert.equal(applied.value.organizations[0].allowInsecureDevelopment, false)
  assert.ok(applied.text.includes('// My UAT'))
  assert.match(applied.text, /false：仅接受 HTTPS/)
  await file.document()
  assert.equal(await readFile(file.backup, 'utf8'), original, 'documentation must not replace the pending content rollback backup')
  await file.rollback()
  assert.equal(await readFile(path, 'utf8'), original)
  assert.deepEqual((await readdir(join(data, 'configuration'))).filter(name => name.endsWith('.jsonc')), ['eduwork.previous.jsonc'])
})

test('explicit HTTP choice survives documentation and additional config fields preserve personal comments', async t => {
  const root = await mkdtemp(join(tmpdir(), 'documented-http-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'eduwork.jsonc')
  await writeFile(path, '{"schemaVersion":1,"organizations":[{/* keep this note */"schemaVersion":"dsh-oidc/v1alpha1","id":"example","allowInsecureDevelopment":true}]}')
  const file = await new ConfigurationFile(path, join(root, 'data')).open()
  await file.document()
  const local = await readConfiguration(path)
  await file.initialize({ ...local.value, desktop: { closeAction: 'exit' } })
  const after = await readConfiguration(path)
  assert.equal(after.value.organizations[0].allowInsecureDevelopment, true)
  assert.ok(after.text.includes('/* keep this note */'))
})
