import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { workbenchAction } from '../workbench-support.mjs'

test('both shells expose honest update status and a diagnostic allowlist without secrets or user content', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-workbench-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = join(root, '配置 with spaces.jsonc'), logs = join(root, 'logs')
  await writeFile(config, JSON.stringify({schemaVersion:1,product:{name:'EduWork'},organizations:[]}))
  await mkdir(logs)
  // Deliberately invalid, visibly synthetic token; no real credential is a fixture.
  await writeFile(join(logs,'desktop-host.log'), 'Authorization: Bearer <synthetic-example-token>\nPrivate conversation text')
  await writeFile(join(logs,'private-conversation.json'), 'Private conversation text')
  for (const shell of ['wails','electron']) {
    const args = {config,logs,version:'0.3.0-rc.3',shell}
    assert.equal((await workbenchAction({...args,action:'status'})).phase,'ready')
    assert.equal((await workbenchAction({...args,action:'check-updates'})).phase,'unconfigured')
    const result = await workbenchAction({...args,action:'diagnostics'})
    const report = JSON.parse(result.report)
    assert.equal(report.shell,shell)
    assert.equal(report.schemaVersion,2)
    assert.equal(report.files.find(file=>file.name==='logs/desktop-host.log').status,'included')
    assert.match(result.filename,/\.zip$/)
    assert.equal(Buffer.from(result.archive,'base64').readUInt32LE(),0x04034b50)
    assert.doesNotMatch(result.report,/synthetic-example-token|Private conversation|private-conversation|with spaces|Authorization/)
  }
  await assert.rejects(workbenchAction({config,version:'0.3.0',shell:'wails',action:'execute'}),/Invalid desktop action/)
})
