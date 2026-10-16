import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneElectronLocales } from '../scripts/electron-locales.mjs'

test('macOS keeps only Chinese and English Electron translations in the app and framework', async t => {
  const app = await mkdtemp(join(tmpdir(), 'eduwork-locales-mac-'))
  t.after(() => rm(app, { recursive: true, force: true }))
  const resources = join(app, 'Contents/Resources'), framework = join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources')
  for (const name of ['en', 'zh_CN', 'ja', 'de']) await mkdir(join(resources, `${name}.lproj`), { recursive: true })
  for (const name of ['en', 'en_GB', 'en_FEMININE', 'zh_CN', 'zh_CN_NEUTER', 'zh_TW', 'ja', 'ja_FEMININE', 'fr']) {
    await mkdir(join(framework, `${name}.lproj`), { recursive: true })
    await writeFile(join(framework, `${name}.lproj/locale.pak`), 'pak')
  }
  await writeFile(join(framework, 'resources.pak'), 'resources')
  const result = await pruneElectronLocales(app, 'darwin')
  assert.deepEqual(await readdir(resources), ['en.lproj', 'zh_CN.lproj'])
  assert.deepEqual((await readdir(framework)).sort(), ['en.lproj', 'en_FEMININE.lproj', 'en_GB.lproj', 'resources.pak', 'zh_CN.lproj', 'zh_CN_NEUTER.lproj', 'zh_TW.lproj'])
  assert.deepEqual(result, { kept: ['en.lproj', 'en_FEMININE.lproj', 'en_GB.lproj', 'zh_CN.lproj', 'zh_CN_NEUTER.lproj', 'zh_TW.lproj'], removed: 5, bytes: 9 })
})

test('Windows keeps only Chinese and English Electron translations and requires both', async t => {
  const app = await mkdtemp(join(tmpdir(), 'eduwork-locales-win-'))
  t.after(() => rm(app, { recursive: true, force: true }))
  await mkdir(join(app, 'locales'))
  for (const name of ['en-US', 'en-GB', 'zh-CN', 'zh-TW', 'ja', 'pt-BR']) await writeFile(join(app, 'locales', `${name}.pak`), 'pak')
  const result = await pruneElectronLocales(app, 'win32')
  assert.deepEqual((await readdir(join(app, 'locales'))).sort(), ['en-GB.pak', 'en-US.pak', 'zh-CN.pak', 'zh-TW.pak'])
  assert.equal(result.removed, 2)
  await rm(join(app, 'locales/zh-CN.pak'))
  await assert.rejects(pruneElectronLocales(app, 'win32'), /locale resource is missing/)
})
