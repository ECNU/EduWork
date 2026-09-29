import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { assetFilePath } from '../scripts/prepare-windows-release-inputs.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

test('Windows Python install resolves the same locked archive name as download', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'dsh-desktop/internal/productruntime/builtin/python-runtime-manifest.json'), 'utf8'))
  const asset = manifest.assets['windows-amd64']
  const file = assetFilePath(asset, join(root, 'inputs/downloads'))

  assert.equal(file, join(root, 'inputs/downloads', 'cpython-3.12.13+20260510-x86_64-pc-windows-msvc-install_only_stripped.tar.gz'))
})
