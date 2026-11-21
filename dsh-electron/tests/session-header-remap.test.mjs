import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { rewriteSessionHeaderCwd, remapSessionLogCwd } from '../src/session-header-remap.mjs'

const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const frame = text => zstdCompressSync(Buffer.from(text, 'utf8'), CHECKSUM)
const headerLine = cwd => JSON.stringify({ type: 'session', version: 4, id: 'session-x', createdAt: 1794645447166, cwd, isSeeded: false, delegationDepth: 0, agentPreset: 'standard' }) + '\n'
const oldPath = 'D:\\Workspace\\EduWork\\wm13\\EduWork\\sample-workspace-internal'
const newPath = 'D:\\Workspace\\EduWork\\experiments\\accept-3\\root-import\\workspaces\\sample-workspace-internal'
const events = ['{"type":"event","seq":1,"kind":"message"}\n', '{"type":"event","seq":2,"kind":"message"}\n']
const artifact = cwd => Buffer.concat([frame(headerLine(cwd)), ...events.map(frame)])

test('rewrites the header cwd and preserves event frames byte-for-byte', () => {
  const after = rewriteSessionHeaderCwd(artifact(oldPath), { compressed: true, oldPath, newPath })
  // Only the header cwd changes; deterministic JSON+zstd means the result equals
  // a freshly built artifact with the new cwd, event frames included.
  assert.deepEqual(after, artifact(newPath))
})

test('the rewritten header frame decompresses with checksum validation', () => {
  const after = rewriteSessionHeaderCwd(artifact(oldPath), { compressed: true, oldPath, newPath })
  const headerFrame = frame(headerLine(newPath))
  const decoded = zstdDecompressSync(after.subarray(0, headerFrame.length))
  assert.equal(decoded.toString('utf8'), headerLine(newPath))
})

test('leaves the artifact unchanged when the header names a different cwd', () => {
  assert.equal(rewriteSessionHeaderCwd(artifact('D:\\other'), { compressed: true, oldPath, newPath }), null)
})

test('handles a plaintext .jsonl header', () => {
  const text = headerLine(oldPath) + events.join('')
  const after = rewriteSessionHeaderCwd(Buffer.from(text, 'utf8'), { compressed: false, oldPath, newPath })
  assert.deepEqual(after, Buffer.from(headerLine(newPath) + events.join(''), 'utf8'))
})

test('supports Chinese workspace paths', () => {
  const cnOld = 'C:\\Users\\测试\\项目', cnNew = 'D:\\数据\\工作区\\项目'
  const after = rewriteSessionHeaderCwd(artifact(cnOld), { compressed: true, oldPath: cnOld, newPath: cnNew })
  assert.deepEqual(after, artifact(cnNew))
})

test('skips torn, non-zstd and non-session artifacts without throwing', () => {
  assert.equal(rewriteSessionHeaderCwd(Buffer.from('not zstd'), { compressed: true, oldPath, newPath }), null)
  assert.equal(rewriteSessionHeaderCwd(artifact(oldPath).subarray(0, 10), { compressed: true, oldPath, newPath }), null)
  assert.equal(rewriteSessionHeaderCwd(Buffer.concat([frame('{"type":"other"}\n')]), { compressed: true, oldPath, newPath }), null)
})

test('remapSessionLogCwd rewrites every session log under a project directory', async () => {
  const base = await mkdtemp(join(tmpdir(), 'eduwork-session-remap-'))
  const project = join(base, 'project')
  await mkdir(join(project, 'session-a'), { recursive: true })
  await mkdir(join(project, 'session-b'), { recursive: true })
  await writeFile(join(project, 'session-a', 'session.v4.jsonl.zstd'), artifact(oldPath))
  await writeFile(join(project, 'session-b', 'session.v4.jsonl.zstd'), artifact(oldPath))
  await writeFile(join(project, 'session-b', 'notes.txt'), 'leave me alone')
  const rewritten = await remapSessionLogCwd(project, oldPath, newPath)
  assert.deepEqual(rewritten.sort(), ['session-a/session.v4.jsonl.zstd', 'session-b/session.v4.jsonl.zstd'])
  for (const name of ['session-a', 'session-b']) {
    assert.deepEqual(await readFile(join(project, name, 'session.v4.jsonl.zstd')), artifact(newPath))
  }
  assert.equal(await readFile(join(project, 'session-b', 'notes.txt'), 'utf8'), 'leave me alone')
})
