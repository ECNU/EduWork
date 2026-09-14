import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,copyFile,symlink,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const run=promisify(execFile)
const source=fileURLToPath(new URL('../',import.meta.url))
const ownRequire=createRequire(new URL('../packages/artifact-services/package.json',import.meta.url))
const ffmpeg=ownRequire('@remotion/renderer').RenderInternals.getExecutablePath({type:'ffmpeg',indent:false,logLevel:'error',binariesDirectory:null})

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'studio-runtime-isolation-'))
  t.after(async()=>{assert.equal(dirname(root),resolve(tmpdir()));await rm(root,{recursive:true,force:true})})
  const studio=join(root,'node_modules','@eduwork/dsh-knowledge-studio')
  const shared=join(studio,'node_modules','@eduwork/dsh-artifact-services')
  const managed=join(root,'managed')
  async function put(path,text) {await mkdir(dirname(path),{recursive:true});await writeFile(path,text)}
  for(const [from,to,files] of [
    [source,studio,['studio-export.js','video-poster.js','studio-content.js','export-recovery.js','office-spec.js','mindmap.js','studio-slides.js']],
    [join(source,'packages','artifact-services'),shared,['runtime.js','music.js','office.js','office-preview.js','presentation-contract.js','structured-spec.js']],
  ]) {
    await mkdir(join(to,'lib'),{recursive:true})
    await copyFile(join(from,'package.json'),join(to,'package.json'))
    for(const file of files)await copyFile(join(from,'lib',file),join(to,'lib',file))
  }
  await mkdir(join(shared,'contracts'),{recursive:true})
  await copyFile(join(source,'packages','artifact-services','contracts','presentation-metrics.json'),join(shared,'contracts','presentation-metrics.json'))
  // Only Studio's declared Markdown dependencies are linked to the development
  // install. Remotion exists exclusively below the shared package or runtime.
  for(const name of ['unified','remark-parse','remark-gfm']) {
    await symlink(join(source,'node_modules',name),join(studio,'node_modules',name),'junction')
  }
  const browser=join(managed,'chrome.exe')
  await put(browser,'browser fixture')
  await put(join(managed,'package.json'),'{}')
  for(const [owner,label] of [[shared,'shared'],[managed,'managed']]) {
    for(const name of ['remotion','@remotion/bundler','@remotion/renderer','@remotion/media','@remotion/captions','mediabunny','react','react-dom']) {
      await put(join(owner,'node_modules',name,'package.json'),JSON.stringify({name,version:name==='mediabunny'?'1.55.5':name.startsWith('react')?'18.3.1':'4.0.520',main:'index.cjs'}))
    }
    await put(join(owner,'node_modules','@remotion','renderer','index.cjs'),`
      const {appendFileSync}=require('node:fs');
      const record=value=>appendFileSync(process.env.PROBE_EVENTS,value+'\\n');
      exports.ensureBrowser=async()=>{record('ensure:${label}');if(process.env.PROBE_FORBID_BROWSER==='1')throw Error('unexpected browser preparation');return {path:process.env.PROBE_BROWSER};};
      exports.RenderInternals={getExecutablePath:()=>{record('ffmpeg:${label}');return process.env.PROBE_FFMPEG;}};
    `)
  }
  await put(join(studio,'node_modules','playwright-core','package.json'),JSON.stringify({name:'playwright-core',type:'module',exports:'./index.js'}))
  await put(join(studio,'node_modules','playwright-core','index.js'),`
    import {appendFileSync,writeFileSync} from 'node:fs';
    import {realpath} from 'node:fs/promises';
    export const chromium={launch:async options=>{
      const executable=await realpath(options.executablePath);
      appendFileSync(process.env.PROBE_EVENTS,'launch:'+executable+'\\n');
      if(executable!==await realpath(process.env.PROBE_BROWSER))throw Error('wrong browser');
      return {newPage:async()=>({route:async()=>{},setContent:async()=>{},evaluate:async()=>{},pdf:async({path})=>writeFileSync(path,'%PDF-fixture')}),close:async()=>{}};
    }};
  `)
  const environment={...process.env,PROBE_BROWSER:browser,PROBE_FFMPEG:ffmpeg,PROBE_EVENTS:join(root,'events')}
  for(const name of ['DSH_MEDIA_NODE_ENV','DSH_MEDIA_BROWSER','ECNU_AGENT_NODE_ENV','ECNU_AGENT_REMOTION_BROWSER'])delete environment[name]
  await put(environment.PROBE_EVENTS,'')
  return {root,studio,managed,browser,environment}
}

async function invoke(f,code) {
  await writeFile(join(f.studio,'probe.mjs'),`
    import assert from 'node:assert/strict';
    import {createRequire} from 'node:module';
    const require=createRequire(import.meta.url);
    assert.throws(()=>require.resolve('@remotion/renderer'),{code:'MODULE_NOT_FOUND'});
    ${code}
  `)
  await run(process.execPath,[join(f.studio,'probe.mjs')],{env:f.environment,windowsHide:true})
  return (await readFile(f.environment.PROBE_EVENTS,'utf8')).trim().split('\n')
}

for(const mode of ['standalone','managed','legacy'])test(`PDF export resolves nested shared dependencies and honors ${mode} browser selection`,async t=>{
  const f=await fixture(t)
  if(mode!=='standalone') {
    f.environment[mode==='managed'?'DSH_MEDIA_NODE_ENV':'ECNU_AGENT_NODE_ENV']=f.managed
    f.environment[mode==='managed'?'DSH_MEDIA_BROWSER':'ECNU_AGENT_REMOTION_BROWSER']=f.browser
    f.environment.PROBE_FORBID_BROWSER='1'
  }
  const events=await invoke(f,`
    import {exportDocument} from './lib/studio-export.js';
    import {readFile} from 'node:fs/promises';
    const result=await exportDocument({id:'report',kind:'report',title:'Probe',citations:[],content:{sections:[{heading:'Test',body:'Report content'}]}},${JSON.stringify(join(f.root,'outputs'))},'pdf');
    assert.equal((await readFile(result.path,'utf8')),'%PDF-fixture');
  `)
  assert.deepEqual(events,[...(mode==='standalone'?['ensure:shared']:[]),'launch:'+await realpath(f.browser)])
})

for(const mode of ['standalone','managed'])test(`first video poster uses ${mode} FFmpeg without preparing a browser`,async t=>{
  const f=await fixture(t)
  f.environment.PROBE_FORBID_BROWSER='1'
  if(mode==='managed')Object.assign(f.environment,{DSH_MEDIA_NODE_ENV:f.managed,DSH_MEDIA_BROWSER:f.browser})
  const video=join(f.root,'input.mp4')
  const frame=join(f.root,'frame.png')
  await writeFile(frame,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'))
  await run(ffmpeg,['-hide_banner','-loglevel','error','-loop','1','-i',frame,'-t','1','-vf','scale=160:90','-c:v','libx264','-pix_fmt','yuv420p',video],{windowsHide:true})
  const events=await invoke(f,`
    import {videoPoster} from './lib/video-poster.js';
    import {readFile} from 'node:fs/promises';
    const result=await videoPoster({path:${JSON.stringify(video)}});
    const bytes=await readFile(result.path);
    assert.equal(bytes.readUInt16BE(0),0xffd8);
    assert.deepEqual(await videoPoster({path:${JSON.stringify(video)}}),result);
  `)
  assert.deepEqual(events,['ffmpeg:'+(mode==='standalone'?'shared':'managed')])
})
