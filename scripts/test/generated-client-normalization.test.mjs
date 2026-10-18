import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { normalizeGeneratedClientText } from '../normalize-generated-client.mjs'

test('bundled dependency comments are identical across Runtime locations without rewriting executable strings or licenses', () => {
  const suffix = 'zod/v4/core/core.js'
  const executable = 'const path = "D:/fixture/runtime/node_modules/zod";\n'
  const license = '/*! Copyright fixture/runtime/node_modules/zod */\n'
  for (const root of ['../../../../software/product/', 'D:/fixture/runtime/', '/tmp/runtime/', 'D:\\fixture\\runtime\\']) {
    const input = `//#region ${root}node_modules/${suffix}\n${executable}${license}`
    assert.equal(normalizeGeneratedClientText(input), `//#region node_modules/${suffix}\n${executable}${license}`)
  }
})

test('Node and PowerShell normalize the same dependency provenance and are idempotent', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-client-normalization-'))
  try {
    const input = '  //#region ..\\..\\runtime\\node_modules\\zod\\v4\\core.js\nconst value = "unchanged";\n'
    const expected = '  //#region node_modules/zod/v4/core.js\nconst value = "unchanged";\n'
    const file = join(root, 'client.js')
    await writeFile(file, input)
    const script = fileURLToPath(new URL('../normalize-generated-client.ps1', import.meta.url))
    execFileSync('pwsh.exe', ['-NoProfile', '-File', script, '-Path', file], { windowsHide: true })
    assert.equal(await readFile(file, 'utf8'), expected)
    assert.equal(normalizeGeneratedClientText(input), expected)
    assert.equal(normalizeGeneratedClientText(expected), expected)
  } finally { await rm(root, { recursive: true, force: true }) }
})
