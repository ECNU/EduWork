import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import Ajv2020 from 'ajv/dist/2020.js'
import { parse as parseYAML } from 'yaml'
import { normalizeEnterpriseProfile } from '../src/host/profile.js'


const root = new URL('../', import.meta.url)
const schema = JSON.parse(await readFile(new URL('schema/enterprise-profile.v1alpha1.schema.json', root), 'utf8'))
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema)

for (const name of ['enterprise-profile.example.json', 'ecnu.enterprise-profile.example.json', 'identity-only.example.json', 'resources-discovery.example.json', 'litellm.enterprise-profile.example.json', 'oidc-llm.enterprise-profile.example.json']) {
  const value = JSON.parse(await readFile(new URL(`examples/${name}`, root), 'utf8'))
  if (!validate(value)) throw new Error(`${name} failed JSON Schema validation: ${JSON.stringify(validate.errors)}`)
  normalizeEnterpriseProfile(value)
}
const resources = parseYAML(await readFile(new URL('protocol/resources.openapi.yaml', root), 'utf8'))
for (const path of ['/models']) if (!resources.paths?.[path]?.get) throw new Error(`public resources missing ${path}`)
assert.equal(resources.paths['/quota'], undefined, 'public contract must not declare institution quota')

const contract = parseYAML(await readFile(new URL('protocol/openapi.yaml', root), 'utf8'))
assert.equal(contract.paths['/bootstrap'], undefined)
assert.ok(Object.keys(contract.paths).every(path => !path.startsWith('/runtime-credential')))
console.log('Enterprise Profile examples and token resource OpenAPI contract are structurally valid.')
