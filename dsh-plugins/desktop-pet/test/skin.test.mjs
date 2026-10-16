import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { BUILTIN_ANIMATIONS, imageProblem, normalizeSkin, resolveAnimation, svgProblem } from '../lib/skin.js'
import { readBuiltinSkins, readSkin } from '../lib/skin-files.js'

const skins = fileURLToPath(new URL('../skins/', import.meta.url))
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
const minimal = (extra = {}) => ({ schemaVersion: 1, id: 'mini', name: 'Mini', frame: { width: 192, height: 208 }, animations: { idle: { image: 'idle.svg' } }, ...extra })

const LICENSES = { 'eduwork-page': 'CC-BY-4.0', 'eduwork-page-blue': 'CC-BY-4.0', 'ecnu-huashi': 'LicenseRef-ECNU-Mascot', dafeiyu: 'MIT' }
// Skins drawn by a script in this package; dafeiyu uses the whale-girl PNG sprites.
const GENERATED = { 'build-page-skins.mjs': ['eduwork-page', 'eduwork-page-blue'], 'build-huashi-skin.mjs': ['ecnu-huashi'] }

test('built-in skins have every state, safe images and a recorded license', async () => {
  const found = await readBuiltinSkins(skins, message => assert.fail(message))
  assert.deepEqual([...found.keys()], ['eduwork-page', 'eduwork-page-blue', 'dafeiyu', 'ecnu-huashi'])
  for (const { skin, preview } of found.values()) {
    for (const name of BUILTIN_ANIMATIONS) assert.ok(skin.animations[name], `${skin.id} ${name}`)
    assert.equal(skin.license, LICENSES[skin.id])
    assert.match(preview.src, /^data:image\/(?:svg\+xml|png);base64,/)
  }
})

test('generated skins are exactly their scripts\' output', async t => {
  const output = await mkdtemp(join(tmpdir(), 'pet-skins-'))
  t.after(() => rm(output, { recursive: true, force: true }))
  await mkdir(join(output, 'scripts'))
  for (const [script, ids] of Object.entries(GENERATED)) {
    await writeFile(join(output, 'scripts', script), await readFile(new URL(`../scripts/${script}`, import.meta.url)))
    execFileSync(process.execPath, [join(output, 'scripts', script)], { stdio: 'ignore' })
    for (const id of ids) {
      const files = await readdir(join(skins, id))
      assert.deepEqual((await readdir(join(output, 'skins', id))).sort(), files.sort())
      for (const name of files) assert.ok((await readFile(join(skins, id, name))).equals(await readFile(join(output, 'skins', id, name))), `${id}/${name}`)
    }
  }
})

test('three animation notations become one frame list', () => {
  const skin = normalizeSkin(minimal({ animations: {
    idle: { frames: ['a.svg', 'b.svg'], fps: 4, playback: 'blink' },
    work: { sheet: 'work.png', frames: 5, columns: 3, row: 1, frameMs: [100, 100, 100, 100, 300] },
    think: { image: 'think.svg', motion: 'float' },
  } }))
  assert.deepEqual(skin.animations.idle.frames, [{ file: 'a.svg', ms: 250 }, { file: 'b.svg', ms: 250 }])
  assert.deepEqual(skin.animations.work.frames.map(frame => frame.crop), [[0, 208], [192, 208], [384, 208], [0, 416], [192, 416]].map(([x, y]) => ({ x, y, width: 192, height: 208 })))
  assert.equal(skin.animations.work.frames[4].ms, 300)
  assert.deepEqual(skin.animations.think, { frames: [{ file: 'think.svg', ms: 125 }], playback: 'loop', motion: 'float' })
  assert.deepEqual(skin.files.sort(), ['a.svg', 'b.svg', 'think.svg', 'work.png'])
  assert.deepEqual(skin.states, { idle: ['idle'], working: ['think'] })
})

test('missing states fall back; built-in skins may not omit them', () => {
  const skin = normalizeSkin(minimal({ animations: { idle: { image: 'idle.svg' }, react: { image: 'react.svg' } } }))
  assert.equal(resolveAnimation(skin, 'done'), skin.animations.react)
  assert.equal(resolveAnimation(skin, 'work'), skin.animations.idle)
  assert.equal(resolveAnimation(skin, 'unknown'), skin.animations.idle)
  assert.throws(() => normalizeSkin(minimal(), { strict: true }), /think/)
})

test('manifests stay data within limits', () => {
  for (const bad of [
    minimal({ schemaVersion: 2 }), minimal({ id: '../x' }), minimal({ script: 'x' }), minimal({ animations: {} }),
    minimal({ animations: { idle: { image: '../idle.svg' } } }), minimal({ animations: { idle: { image: 'idle.gif' } } }),
    minimal({ animations: { idle: { image: 'a.svg', frames: ['b.svg'] } } }), minimal({ animations: { idle: { frames: Array(65).fill('a.svg') } } }),
    minimal({ animations: { idle: { image: 'a.svg', fps: 31 } } }), minimal({ animations: { idle: { frames: ['a.svg'], frameMs: [1, 2] } } }),
    minimal({ animations: { idle: { image: 'a.svg', motion: 'spin' } } }), minimal({ states: { working: ['missing'] } }),
    minimal({ name: 'a\nb' }), minimal({ lines: { done: { 'zh-CN': ['x'.repeat(61)] } } }), minimal({ anchors: { badge: [500, 0] } }),
    minimal({ license: 'see https://example.org' }),
  ]) assert.throws(() => normalizeSkin(bad), /形象包无效/, JSON.stringify(bad).slice(0, 120))
})

test('SVG must be self-contained, script-free and readable by the hit test', () => {
  assert.equal(svgProblem(svg), null)
  assert.equal(svgProblem('<?xml version="1.0"?><!-- art --><svg viewBox="0 0 1 1"><defs><clipPath id="c"/></defs><g clip-path="url(#c)"/><use href="#c"/></svg>'), null)
  for (const bad of ['<html/>', '<svg width="1"/>', '<!DOCTYPE svg><svg viewBox="0 0 1 1"/>', '<svg viewBox="0 0 1 1"><script>x</script></svg>',
    '<svg viewBox="0 0 1 1"><foreignObject/></svg>', '<svg viewBox="0 0 1 1" onload="x()"/>', '<svg viewBox="0 0 1 1"><image href="https://example.org/a.png"/></svg>',
    '<svg viewBox="0 0 1 1"><style>@import "x.css"</style></svg>', '<svg viewBox="0 0 1 1"><rect fill="url(https://example.org/#a)"/></svg>',
    '<svg viewBox="0 0 1 1"><use xlink:href="other.svg#a"/></svg>']) assert.ok(svgProblem(bad), bad)
})

test('bitmap content must match its extension and size limit', () => {
  const png = (width, height) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([width >> 24, width >> 16 & 255, width >> 8 & 255, width & 255, height >> 24, height >> 16 & 255, height >> 8 & 255, height & 255])])
  const webp = (width, height) => { const bytes = Buffer.alloc(30); bytes.write('RIFF', 0); bytes.write('WEBP', 8); bytes.write('VP8X', 12); bytes.writeUIntLE(width - 1, 24, 3); bytes.writeUIntLE(height - 1, 27, 3); return bytes }
  assert.equal(imageProblem('a.png', png(192, 208)), null)
  assert.equal(imageProblem('a.webp', webp(1536, 1872)), null)
  assert.ok(imageProblem('a.png', webp(10, 10)))
  assert.ok(imageProblem('a.webp', png(10, 10)))
  assert.ok(imageProblem('a.png', png(5000, 10)))
  assert.ok(imageProblem('a.svg', Buffer.from('<svg viewBox="0 0 1 1"><script/></svg>')))
})

test('a skin directory accepts only regular, listed, valid files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pet-skin-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'skin.json'), JSON.stringify(minimal()))
  await writeFile(join(root, 'outside.svg'), svg)
  await symlink(join(root, 'outside.svg'), join(root, 'idle.svg'))
  await assert.rejects(readSkin(root), /普通文件/)
  await rm(join(root, 'idle.svg'))
  await writeFile(join(root, 'idle.svg'), '<svg viewBox="0 0 1 1"><script/></svg>')
  await assert.rejects(readSkin(root), /idle\.svg/)
  await writeFile(join(root, 'idle.svg'), svg)
  assert.equal((await readSkin(root)).id, 'mini')
})
