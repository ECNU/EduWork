import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('product Agent Presets derivative keeps official surfaces and adds only optional-preset policy', () => {
  assert.deepEqual(manifest.chatecnuWork.replaces, ['@deepseek-ai/dsh-client-ui-agent-preset'])
  assert.match(client, /conversation\.hero\.agentPreset/)
  assert.match(client, /id: "agent-presets"/)
  assert.match(client, /PRODUCT_OPTIONAL_PRESETS/)
  assert.match(client, /enabledOptionalPresets/)
  assert.match(client, /role: "switch"/)
  assert.match(client, /ctx\.remote\.settings\.update\("chatecnu-brand", \{ enabledOptionalPresets: enabled \}, void 0\)/)
  assert.doesNotMatch(client, /id: "@deepseek-ai\/dsh-client-ui-agent-preset"/)
})

test('optional preset cards keep their positions across all enable combinations', async () => {
  const build = await readFile(new URL('../build-client.ps1', import.meta.url), 'utf8')
  const helper = source => source.slice(source.indexOf('const PRODUCT_OPTIONAL_PRESETS ='), source.indexOf('function AgentPresetSection', source.indexOf('const PRODUCT_OPTIONAL_PRESETS ='))).trim()
  assert.equal(helper(client), helper(build), 'Checked-in client matches the build template')
  const productPresetRows = new Function(`${helper(client)}; return productPresetRows`)()
  for (const enabled of [[], ['cordis'], ['minimal'], ['cordis', 'minimal']]) {
    const rows = [
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'ptc', trust: 'system' },
      ...enabled.map(id => ({ id, trust: 'system', broken: 'synthetic error' })),
      { id: 'custom-b', trust: 'user' },
      { id: 'custom-a', trust: 'user' },
    ]
    const before = structuredClone(rows)
    const result = productPresetRows(rows)
    assert.deepEqual(result.filter(row => row.trust === 'system').map(row => row.id), ['standard', 'ptc', 'minimal', 'cordis'])
    assert.deepEqual(result.filter(row => row.trust === 'user').map(row => row.id), ['custom-b', 'custom-a'])
    for (const row of rows) assert.equal(result.find(item => item.id === row.id), row, 'Keep real roster metadata')
    for (const id of ['minimal', 'cordis']) assert.equal(Boolean(result.find(row => row.id === id).productDisabled), !enabled.includes(id))
    assert.deepEqual(rows, before, 'Do not mutate the roster')
  }
})
