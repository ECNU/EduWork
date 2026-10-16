// Component/contract regression checks, not a substitute for assembled-host or
// desktop acceptance. All documents, addresses and RPC responses are synthetic.
// node tests/official-preview-routing.mjs --runtime <pinned-runtime>
//   --dependencies <plugin-dependencies> --browser <chromium> --output <new-dir>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: Object.fromEntries(['runtime', 'dependencies', 'browser', 'output'].map(key => [key, { type: 'string' }])) })
for (const key of ['runtime', 'dependencies', 'browser', 'output']) assert.ok(values[key], `--${key} is required`)
const source = fileURLToPath(new URL('../', import.meta.url)), output = resolve(values.output)
await mkdir(output)
const runtime = resolve(values.runtime), dependencies = resolve(values.dependencies)
const require = createRequire(join(runtime, 'package.json'))
const { build } = require('esbuild'), { chromium } = require('playwright-core')
const studio = join(source, 'packages/dsh-knowledge-studio')
const shared = join(studio, 'packages/artifact-services')
const manifest = JSON.parse(await readFile(join(shared, 'package.json'), 'utf8'))
const alias = Object.fromEntries(Object.entries(manifest.exports).map(([key, path]) => [manifest.name + (key === '.' ? '' : key.slice(1)), join(shared, path)]))
// The real ModuleLoader supplies one React instance. A package-local npm ci
// must not cause the synthetic component harness to bundle a second instance.
for (const name of ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']) alias[name] = require.resolve(name)
for (const name of ['path', 'url', 'process']) alias[`node:${name}`] = join(studio, `src/client/shims/${name}.ts`)
const harness = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {artifactTabDefinition,installSidebarPreview} from ${JSON.stringify(join(source, 'dsh-plugins/client-ui-media-artifacts/src/client/sidebar-preview.js'))};
import {sessionFileAddress,parseFileAddress} from '@deepseek-ai/dsh-util-workspace-path';
import {openStudioFilePreview} from ${JSON.stringify(join(studio, 'src/client/file-preview.ts'))};
import {StudioArtifact} from ${JSON.stringify(join(studio, 'src/client/StudioArtifact.tsx'))};
import {StudioLocale,dictionaries} from ${JSON.stringify(join(studio, 'src/client/locale.ts'))};
const root=createRoot(document.getElementById('root')), h=React.createElement;
let Tab, read, calls=[], replacements=[], releases=[];
const ctx={get(name){return name==='sidebarRight'?{openResource(){throw Error('Must use the owning tab action')}}:{register(){return()=>{}}}},effect(fn){fn()},slots:{inject(name,fn){fn()},register(def,component){Tab=component;return()=>{}}}};
installSidebarPreview(ctx,{previewFile:(...args)=>read(...args),revealFile:async()=>{}});
const media=(path,loader,revision=0)=>{const signal=new AbortController().signal;read=loader;root.render(h(Tab,{previewFile:(...args)=>{calls.push(args);return read(...args)},revealFile:async()=>{},useTabInfo:()=>({tab:{contentId:sessionFileAddress('owning-session',path),navigation:{revision},signal,actions:{openResource:(...args)=>replacements.push(args),close(){throw Error('Use atomic replacement')}}}})}))};
window.probe={calls,replacements,
 routing(){return ['sample.doc','sample.docx','sample.pptx','sample.xlsx','sample.pdf','sample.html','sample.md','sample.svg','sample.wav','sample.MP4'].map(path=>[path,artifactTabDefinition.canOpen(sessionFileAddress('owner',path))])},
 studioAddress(){let address;openStudioFilePreview({openResource(value){address=value}},'saved-session','C:/saved exports/中文 #50%.docx');return parseFileAddress(address)},
 oldTab(){media('old.docx',()=>{throw Error('Must not invoke legacy preview')})},
 fail(){media('sound.wav',async()=>{throw Error('Synthetic read failure')})},
 recover(){read=async()=>({name:'sound.wav',encoding:'url',mime:'audio/wav',data:'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='})},
 pending(){media('old.wav',()=>new Promise(resolve=>releases.push(resolve)))},
 navigate(){media('new.mp4',async()=>({name:'new.mp4',encoding:'url',mime:'video/mp4',data:'data:video/mp4;base64,'}),1)},
 release(){for(const resolve of releases)resolve({name:'old.wav',encoding:'url',mime:'audio/wav',data:'stale.wav'})},
 studio(){root.render(h(StudioLocale.Provider,{value:key=>dictionaries.en[key]},h(StudioArtifact,{artifact:{id:'synthetic-slides',kind:'slides',status:'completed',title:'Saved slides',exports:[{format:'pptx',path:'C:/saved exports/中文 #50%.pptx'}],content:{slides:[{id:'one',title:'Original outline',bullets:['Original content'],notes:'Keep these speaker notes'}]},citations:[],parameters:{}},exportFile:()=>{throw Error('Opening preview must not export another file')},previewFile:path=>calls.push(['studio',path]),manage(){},back(){},close(){}})))},
};
`
const bundle = join(output, 'harness.js')
await build({ stdin: { contents: harness, resolveDir: source, loader: 'js' }, outfile: bundle, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', alias, nodePaths: [join(runtime, 'node_modules'), join(dependencies, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' } })
const browser = await chromium.launch({ executablePath: resolve(values.browser), headless: true })
const page = await browser.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.setContent('<!doctype html><html lang="en"><body><div id="root"></div></body></html>')
  await page.addScriptTag({ path: bundle })
  const routing = await page.evaluate(() => window.probe.routing())
  assert.deepEqual(routing.map(row => row[1]), [false, false, false, false, false, false, false, false, true, true])
  assert.deepEqual(await page.evaluate(() => window.probe.studioAddress()), { scope: 'session', sessionId: 'saved-session', path: 'C:/saved exports/中文 #50%.docx' })
  await page.evaluate(() => window.probe.oldTab())
  await page.waitForFunction(() => window.probe.replacements.length === 1)
  const replacement = await page.evaluate(() => ({ replacement: window.probe.replacements[0], calls: window.probe.calls }))
  assert.deepEqual(replacement.replacement[1], { replaceTab: true })
  assert.match(replacement.replacement[0], /owning-session/)
  assert.deepEqual(replacement.calls, [])
  await page.evaluate(() => window.probe.fail())
  await page.getByRole('alert').getByText('Synthetic read failure').waitFor()
  await page.evaluate(() => window.probe.recover())
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.getByLabel('sound.wav', { exact: true }).waitFor()
  assert.deepEqual((await page.evaluate(() => window.probe.calls)).at(-1), ['owning-session', 'sound.wav'])
  await page.evaluate(() => window.probe.pending())
  await page.waitForFunction(() => window.probe.calls.some(call => call[1] === 'old.wav'))
  await page.evaluate(() => window.probe.navigate())
  await page.getByLabel('new.mp4', { exact: true }).waitFor()
  await page.evaluate(() => window.probe.release())
  await page.waitForTimeout(50)
  assert.equal(await page.locator('video').getAttribute('aria-label'), 'new.mp4')
  assert.equal(await page.locator('audio').count(), 0, 'An old response must not replace the new file')
  await page.evaluate(() => window.probe.studio())
  await page.getByRole('button', { name: /Open file preview/ }).click()
  assert.deepEqual((await page.evaluate(() => window.probe.calls)).at(-1), ['studio', 'C:/saved exports/中文 #50%.pptx'])
  assert.equal(await page.locator('[data-studio-office-preview]').count(), 0)
  await page.locator('[data-studio-slide-notes] summary').click()
  await page.getByText('Keep these speaker notes', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, scope: 'synthetic component and public API contracts', checks: ['official document ownership', 'session-scoped Unicode and escaped paths', 'old tab replacement', 'media retry', 'late response discarded on navigation', 'Studio opens saved file without re-exporting', 'speaker notes retained'], errors }, null, 2))
  console.log('Official preview routing checks passed')
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ message: error.message, errors }, null, 2))
  throw error
} finally { await browser.close() }
