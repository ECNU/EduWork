import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('remote methods keep SRC-compatible identifier parameters', async () => {
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  for (const signature of ['list()', 'create(input)', 'importDirectory(sourcePath)', 'trashPersonalSkill(name)']) {
    assert.match(source, new RegExp(signature.replace(/[()]/gu, '\\$&'), 'u'))
  }
  assert.doesNotMatch(source, /\w+\([^)]*=/u)
  assert.doesNotMatch(source, /\w+\(\s*\{/u)
})
