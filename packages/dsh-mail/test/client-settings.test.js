import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')

test('settings follow account, servers, advanced, then agent access', () => {
  const account = source.indexOf('<section style={styles.card}><h3 style={{ margin: 0, fontSize: 15 }}>{copy.identity}</h3>')
  const servers = source.indexOf('{copy.servers}</h3>')
  const advanced = source.indexOf('{copy.advanced}</strong>')
  const access = source.indexOf('{copy.agentAccess}</h3>')

  assert.ok(account >= 0)
  assert.ok(servers > account)
  assert.ok(advanced > servers)
  assert.ok(access > advanced)
})

test('rare mailbox fields stay behind Advanced settings', () => {
  const advancedContent = source.indexOf('advancedOpen &&')
  assert.ok(source.indexOf("field(copy.username, 'username'", advancedContent) > advancedContent)
  assert.ok(source.indexOf("field(copy.inbox, 'inboxFolder'", advancedContent) > advancedContent)
  assert.match(source, /email: '\u90ae\u7bb1\u5730\u5740'/)
  assert.doesNotMatch(source, /email: '\u53d1\u4ef6\u90ae\u7bb1\u5730\u5740'/)
})

test('agent capabilities cannot be enabled before their account path is ready', () => {
  assert.match(source, /disabled=\{!ready && !draft\[key\]\}/)
  assert.match(source, /const readReady =/)
  assert.match(source, /const sendReady =/)
})

test('settings use the rc.1 reactive scope and fenced atomic mutations', () => {
  assert.match(source, /settingsScope\.bind\(\{ namespace: NS \}\)/)
  assert.match(source, /useSyncExternalStore\(subscribe, getSnapshot, getSnapshot\)/)
  assert.match(source, /service\.scope\.mutate\(ops, snapshot\.revision\)/)
  assert.match(source, /disabled=\{busy \|\| !snapshot\.writable\}/)
  assert.match(source, /credentials\[PASSWORD_REF\]\?\.writable === true/)
  assert.doesNotMatch(source, /remote\.settings|settings\.replace|settings\.describe/)
})
