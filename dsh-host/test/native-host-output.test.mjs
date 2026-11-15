import test from 'node:test'
import assert from 'node:assert/strict'
import {access, mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {prepareNative} from '../prepare-native.mjs'

const upstream = process.env.EDUWORK_TEST_UPSTREAM

test('prepared Host ships every local module imported by its compiled entry points', {skip: !upstream}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-host-output-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const output = join(root, 'prepared')
  const receipt = await prepareNative({upstream, output})
  for (const file of Object.keys(receipt.outputs).filter(file => /\.(?:mjs|js)$/.test(file))) {
    const content = await readFile(join(output, file), 'utf8')
    for (const [, specifier] of content.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      assert.doesNotMatch(specifier, /\.ts$/, `${file} must refer to emitted JavaScript`)
      await assert.doesNotReject(access(resolve(output, dirname(file), specifier)), `${file} imports missing ${specifier}`)
    }
  }
})
