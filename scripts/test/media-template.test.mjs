import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rename,rm,access} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import {buildVideoTemplate} from '../../packages/dsh-knowledge-studio/scripts/build-video-template.mjs'
import {verifyMediaTemplate} from '../verify-media-template.mjs'
import {copyProductTree} from '../portable-product-links.mjs'

const sharedSource = fileURLToPath(new URL('../../packages/dsh-knowledge-studio/packages/artifact-services/', import.meta.url))
const verifier = fileURLToPath(new URL('../verify-media-template.mjs', import.meta.url))
const assembler = fileURLToPath(new URL('../assemble-017-source-product.mjs', import.meta.url))
const runtime = process.env.EDUWORK_TEST_RUNTIME

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-media-template-'))
  t.after(() => rm(root, {recursive:true, force:true}))
  const artifactRoot = join(root, 'source/packages/dsh-knowledge-studio/packages/artifact-services')
  await mkdir(join(artifactRoot, 'templates/structured'), {recursive:true})
  await copyFile(join(sharedSource, 'package.json'), join(artifactRoot, 'package.json'))
  await copyFile(join(sharedSource, 'templates/structured/video-template.jsx'), join(artifactRoot, 'templates/structured/video-template.jsx'))
  return {root, artifactRoot}
}

test('a clean source build generates a usable shared template and preserves it across product relocation', {skip:!runtime && 'Set EDUWORK_TEST_RUNTIME to the pinned DSH Runtime'}, async t => {
  const {root, artifactRoot} = await fixture(t)
  const {transform,build} = createRequire(join(runtime, 'package.json'))('esbuild')
  const output = await buildVideoTemplate({artifactRoot, transform})
  const built = await verifyMediaTemplate(artifactRoot)
  assert.ok(built.bytes > 0)
  assert.equal(spawnSync(process.execPath, ['--check', output], {encoding:'utf8'}).status, 0)
  // Resolve the actual emitted entry point as the renderer's bundler will.
  await build({entryPoints:[output], bundle:true, write:false, platform:'browser', external:['react','remotion']})

  const product = join(root, 'product')
  await copyProductTree(artifactRoot, join(product, 'd/node_modules/@eduwork/dsh-artifact-services'))
  const relocated = join(root, 'relocated product')
  await rename(product, relocated)
  const checked = spawnSync(process.execPath, [verifier, relocated], {encoding:'utf8'})
  assert.equal(checked.status, 0, checked.stderr)
  assert.deepEqual(JSON.parse(checked.stdout), built)

  // An incremental stage must rebuild from JSX rather than retain stale JS.
  await writeFile(output, 'stale template')
  await buildVideoTemplate({artifactRoot, transform})
  assert.deepEqual(await verifyMediaTemplate(artifactRoot), built)
})

test('published version and a legacy Studio template cannot mask the missing shared template', async t => {
  const {root, artifactRoot} = await fixture(t)
  const studioLib = join(root, 'source/packages/dsh-knowledge-studio/lib')
  await mkdir(studioLib, {recursive:true})
  await writeFile(join(studioLib, 'video-template.js'), 'export default "legacy"')
  assert.equal(JSON.parse(await readFile(join(artifactRoot, 'package.json'), 'utf8')).name, '@eduwork/dsh-artifact-services')
  await assert.rejects(verifyMediaTemplate(artifactRoot), /Missing media template/)
})

for (const contents of ['', ' \n\t']) {
  test(`rejects a ${contents ? 'whitespace-only' : 'zero-byte'} generated file`, async t => {
    const {artifactRoot} = await fixture(t)
    await mkdir(join(artifactRoot, 'lib'))
    await writeFile(join(artifactRoot, 'lib/video-template.js'), contents)
    await assert.rejects(verifyMediaTemplate(artifactRoot), /[Ee]mpty media template/)
  })
}

test('rejects a directory at the runtime entry point', async t => {
  const {artifactRoot} = await fixture(t)
  await mkdir(join(artifactRoot, 'lib/video-template.js'), {recursive:true})
  await assert.rejects(verifyMediaTemplate(artifactRoot), /Invalid or empty media template/)
})

test('source assembly fails before copying the Runtime when media assets were not built', async t => {
  const {root} = await fixture(t)
  const source = join(root, 'source'), inputRuntime = join(root, 'runtime'), output = join(root, 'product')
  await mkdir(inputRuntime)
  await writeFile(join(inputRuntime, '.chatecnu-dsh-runtime.json'), JSON.stringify({dshVersion:'0.2.0-rc.1', dshCommit:'4878cdabd87d4041bdaff61d04c966883b9fd07a'}))
  await mkdir(join(source, 'config/distributions'), {recursive:true})
  await writeFile(join(source, 'config/distributions/generic.json'), '{}')
  const result = spawnSync(process.execPath, [assembler, '--runtime', inputRuntime, '--source', source, '--dependencies', join(root, 'deps'), '--host', join(root, 'host'), '--output', output], {encoding:'utf8'})
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Missing media template/)
  await assert.rejects(access(output), {code:'ENOENT'})
})
