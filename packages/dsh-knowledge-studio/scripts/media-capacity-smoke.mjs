import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {createMediaRuntime,getMediaFFmpegPath} from '../packages/artifact-services/lib/runtime.js'
import {prepareComposition,renderComposition} from '../packages/artifact-services/lib/remotion.js'
import {probeAudioDuration,runVideoCommand} from '../packages/artifact-services/lib/video-runner.js'
import {MediaProviders} from '../packages/artifact-services/lib/providers.js'
import {loadMusicCatalog,defaultMusicRoot} from '../packages/artifact-services/lib/music.js'

const directory=resolve(process.env.STUDIO_CAPACITY_OUTPUT||'dist/rc4-capacity/media')
await mkdir(directory,{recursive:true})
await writeFile(join(directory,'process.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}))
const runtime=await createMediaRuntime(),ffmpeg=await getMediaFFmpegPath({runtime}),providers=new MediaProviders()
await loadMusicCatalog(providers)
const catalog=JSON.parse(await readFile(join(defaultMusicRoot,'catalog.json'),'utf8'))
const resolution=[]
for(const importer of ['packages/artifact-services','node_modules/@remotion/media','node_modules/@remotion/media-utils','node_modules/@remotion/studio','node_modules/@remotion/timeline-utils','node_modules/@remotion/web-renderer']){
  const entry=await realpath(createRequire(resolve(importer,'package.json')).resolve('mediabunny'))
  resolution.push({importer,entry})
}
assert.equal(new Set(resolution.map(row=>row.entry)).size,1,'All render importers must use a single mediabunny')
assert.equal(JSON.parse(await readFile('node_modules/mediabunny/package.json','utf8')).version,'1.55.5')
for(const file of ['package-lock.json','packages/artifact-services/templates/node-environment/package-lock.json']){
  const lock=JSON.parse(await readFile(file,'utf8'))
  const copies=Object.entries(lock.packages).filter(([key])=>key.endsWith('/mediabunny'))
  assert.deepEqual(copies.map(([key,value])=>[key,value.version]),[['node_modules/mediabunny','1.55.5']])
}
const decode=path=>{
  const wav=execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-i',path,'-ar','32000','-ac','2','-c:a','pcm_s16le','-f','wav','pipe:1'],{windowsHide:true,maxBuffer:32*1024*1024})
  for(let i=12;i+8<=wav.length;){const size=wav.readUInt32LE(i+4);if(wav.toString('ascii',i,i+4)==='data')return wav.subarray(i+8,Math.min(wav.length,i+8+size));i+=8+size+(size%2)}
  throw new Error('No decoded PCM')
}
const tracks=[]
for(const track of catalog.tracks){
  const item=providers.music(track.id),bytes=await readFile(item.path),pcm=decode(item.path)
  assert.equal(item.mime,'mpeg');assert.equal(createHash('sha256').update(bytes).digest('hex'),track.sha256)
  const probeDuration=await probeAudioDuration(item.path,runtime,track.id)
  assert.ok(Math.abs(probeDuration-track.durationSeconds)<0.1)
  assert.equal(pcm.length/128000,track.durationSeconds)
  tracks.push({id:track.id,bytes:bytes.length,probeDuration,decodedSeconds:pcm.length/128000})
}
// Same licensed catalog is staged by the conversation runner without conversion.
const projectRoot=join(directory,'conversation-project');await mkdir(projectRoot,{recursive:true})
const workspace=await runVideoCommand('init',{'project-root':projectRoot,name:'rc4-bgm'},runtime)
const staged=await runVideoCommand('stage-bgm',{'project-root':projectRoot,workspace:workspace.workspace,'track-id':catalog.tracks[0].id},{bgmRoot:defaultMusicRoot})
assert.ok(staged.destination.endsWith('.mp3'))

// Render beyond a complete BGM loop and measure ducking with a silent narration
// fixture: real voices/video are exercised separately by local-media-smoke.
const track=catalog.tracks[0],source=decode(providers.music(track.id).path)
const silent=Buffer.alloc(44+32000*2*2*2)
silent.write('RIFF');silent.writeUInt32LE(silent.length-8,4);silent.write('WAVEfmt ',8);silent.writeUInt32LE(16,16);silent.writeUInt16LE(1,20);silent.writeUInt16LE(2,22);silent.writeUInt32LE(32000,24);silent.writeUInt32LE(128000,28);silent.writeUInt16LE(4,32);silent.writeUInt16LE(16,34);silent.write('data',36);silent.writeUInt32LE(silent.length-44,40)
const bgm={audio:'data:audio/mpeg;base64,'+(await readFile(providers.music(track.id).path)).toString('base64'),volume:.16,duckVolume:.06}
const inputProps={fps:30,aspect:'16:9',subtitles:false,bgm,scenes:[{heading:'MP3 loop and ducking',bullets:[],text:'',startFrame:0,frames:61*30,fromFrame:3*30,audioFrames:2*30,audio:'data:audio/wav;base64,'+silent.toString('base64')}]}
const prepared=await prepareComposition({entryPoint:resolve('packages/artifact-services/lib/video-template.js'),outDir:join(directory,'bundle'),id:'StudioVideo',inputProps,runtime})
const output=join(directory,'loop-ducking.wav')
await renderComposition(prepared,{output,format:'wav',onProgress:(_,p)=>console.log('mix',Math.floor(p))})
const pcm=decode(output)
assert.ok(Math.abs(pcm.length/128000-61)<0.05)
function ratio(start,end){let actual=0,original=0;for(let frame=Math.round(start*32000);frame<Math.round(end*32000);frame++){for(let c=0;c<2;c++){const value=pcm.readInt16LE(frame*4+c*2),reference=source.readInt16LE((frame%(source.length/4))*4+c*2);actual+=value*value;original+=reference*reference}}return Math.sqrt(actual/original)}
const gain={normal:ratio(1,2),ducked:ratio(3.5,4.5),resumed:ratio(6,7),secondLoop:ratio(49,50)}
for(const [key,value] of Object.entries(gain))assert.ok(Math.abs(value-(key==='ducked'?.06:.16))<.015,`${key}: ${value}`)
await writeFile(join(directory,'result.json'),JSON.stringify({passed:true,mediabunny:'1.55.5',resolution,tracks,conversationStage:staged,gain,durationSeconds:pcm.length/128000,externalModelCalls:0},null,2))
console.log(JSON.stringify({passed:true,gain,directory}))
