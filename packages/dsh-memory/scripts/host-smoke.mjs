import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { start } from './harness.mjs'
const host = await start()
try {
  const bootstrap = await fetch(host.url, { redirect: 'manual' })
  assert.ok([302, 303].includes(bootstrap.status))
  const cookie = bootstrap.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const response = await fetch(new URL(bootstrap.headers.get('location'), host.url), { headers: { cookie } })
  assert.equal(response.status, 200)
  await writeFile(path.join(host.directory, 'host-result.json'), JSON.stringify({ passed: true, dsh: host.dsh, package: host.package }))
  console.log('Independent packed Host passed:', host.directory)
} finally { await host.stop() }
