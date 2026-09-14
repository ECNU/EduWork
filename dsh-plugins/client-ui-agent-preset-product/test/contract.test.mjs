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
