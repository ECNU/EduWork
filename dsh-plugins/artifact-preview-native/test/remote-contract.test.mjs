import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const service = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
const reveal = await readFile(new URL('../lib/reveal.js', import.meta.url), 'utf8')
const remote = await readFile(new URL('../lib/typert.remote-client.js', import.meta.url), 'utf8')
const host = await readFile(new URL('../lib/typert.host.js', import.meta.url), 'utf8')

test('artifact native remote exposes workspace-bounded preview, reveal and file-import methods', () => {
  assert.match(remote, /method: 'read'/)
  assert.match(remote, /method: 'reveal'/)
  assert.match(remote, /method: 'importFiles'/)
  assert.match(remote, /method: 'importNativeFiles'/)
  assert.match(remote, /descriptors: \[read, reveal, importFiles, importNativeFiles\]/)
  assert.match(host, /invocations: \[read, reveal, importFiles, importNativeFiles\]/)
  assert.match(service, /fs\.contains\(root, target\)/)
  assert.match(service, /importWorkspaceFiles\(this\.ctx\.fs\.processPath\(root\), files\)/)
  assert.match(service, /importGrantedWorkspaceFiles/)
  assert.match(service, /CHATECNU_WORK_FILE_INTAKE_ROOT/)
  assert.match(service, /Remote\('importNativeFiles'\)/)
  assert.match(service, /renderOfficePreview/)
  assert.match(reveal, /explorer\.exe/)
  assert.match(reveal, /path\.win32\.normalize\(target\)/)
  assert.match(reveal, /child\.once\('exit'/)
  assert.doesNotMatch(reveal, /shell:\s*true/)
})
