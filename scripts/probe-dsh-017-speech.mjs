// Real candidate registry + FFmpeg, synthetic recognizer. Never download speech models.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {parseArgs} from 'node:util'
import {validateNpmRuntimeLock} from '../dsh-desktop/scripts/prepare-dsh-runtime.mjs'
import {TranscriptionService} from '../packages/dsh-knowledge-studio/packages/artifact-services/lib/transcription.js'
import {createDshTranscriptionProvider,transcribeDshWave} from '../packages/dsh-knowledge-studio/packages/artifact-services/lib/transcription-dsh.js'

const {values}=parseArgs({options:{runtime:{type:'string'},output:{type:'string'},ffmpeg:{type:'string'}}})
if(!values.runtime||!values.output)throw new Error('Use --runtime <prepared candidate> --output <new synthetic directory> [--ffmpeg <absolute provisioned path>]')
const runtime=resolve(values.runtime),output=resolve(values.output)
const json=async path=>JSON.parse(await readFile(path,'utf8'))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const contract=fileURLToPath(new URL('../third_party/dsh/candidate-v0.1.7-rc.1/',import.meta.url))
const lock=await json(join(contract,'LOCK.json')),manifest=await json(join(contract,'npm-runtime/package.json'))
const packageLockBytes=await readFile(join(contract,'npm-runtime/package-lock.json'))
validateNpmRuntimeLock({manifest,lock,packageLockBytes,packageLock:JSON.parse(packageLockBytes)})
const receipt=await json(join(runtime,'.chatecnu-dsh-runtime.json'))
assert.equal(receipt.source,'npm-lock');assert.equal(receipt.dshVersion,lock.packageVersion)
assert.equal(receipt.dshCommit,lock.commit);assert.equal(receipt.platform,process.platform);assert.equal(receipt.arch,process.arch)
assert.equal(receipt.packageLockSHA256,lock.runtime.npm.packageLockSHA256)
assert.equal(hash(await readFile(join(runtime,'.chatecnu-dsh-npm-install-lock.json'))),receipt.packageLockSHA256)
const require=createRequire(join(runtime,'package.json'))
const load=async name=>{
  const packageName=name.split('/').slice(0,2).join('/')
  assert.equal((await json(join(runtime,'node_modules',packageName,'package.json'))).version,manifest.dependencies[packageName])
  return import(pathToFileURL(require.resolve(name)).href)
}
await mkdir(output)
const report={version:lock.packageVersion,startedAt:new Date().toISOString(),success:false,
  scope:'real DSH speech registry and FFmpeg; synthetic audio and recognizer',modelInference:'not-tested',desktopAcceptance:'not-tested'}
let ctx
try {
  const {Context}=await load('@deepseek-ai/cordis')
  const {default:SpeechToText}=await load('@deepseek-ai/dsh-experimental-speech-to-text')
  const {validateWave}=await load('@deepseek-ai/dsh-experimental-speech-to-text/wave')
  ctx=new Context()
  await ctx.plugin(SpeechToText,{defaultProvider:'synthetic-cloud',language:'en'})
  const speech=ctx.speechToText,chunks=[]
  assert.ok(speech)
  let unregister=speech.register({
    info:{id:'sensevoice-local',name:'Synthetic local recognizer',location:'host-local',languages:['auto','zh','en']},
    async transcribe({audio,language}) {
      const seconds=validateWave(audio,60)
      assert.equal(language,'zh');assert.ok(audio.byteLength<4*1024*1024)
      chunks.push(seconds)
      return {text:`synthetic-${chunks.length}`,audioSeconds:seconds,inferenceSeconds:0}
    },
  })
  speech.register({info:{id:'synthetic-cloud',name:'Must not be selected',location:'cloud',languages:['auto','zh','en']},transcribe(){assert.fail('Audio must never go to cloud')}})
  const {RenderInternals}=require('@remotion/renderer')
  const ffmpegPath=values.ffmpeg?resolve(values.ffmpeg):RenderInternals.getExecutablePath({type:'ffmpeg',indent:false,logLevel:'error',binariesDirectory:null})
  // 121 seconds at 8 kHz: exercise real resampling and more than one upstream request.
  const duration=121,dataBytes=duration*8000*2,wav=Buffer.alloc(44+dataBytes)
  wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8)
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22)
  wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34)
  wav.write('data',36);wav.writeUInt32LE(dataBytes,40)
  const inputPath=join(output,'合成录音.wav')
  await writeFile(inputPath,wav)
  const service=new TranscriptionService()
  service.register(createDshTranscriptionProvider({speechToText:speech,ffmpegPath}))
  assert.equal((await service.list())[0].available,true)
  const result=await service.transcribe({provider:'dsh-sensevoice',inputPath,directory:output,language:'zh-CN'})
  assert.deepEqual(chunks,[60,60,1])
  assert.deepEqual(result,{provider:'dsh-sensevoice',text:'synthetic-1\nsynthetic-2\nsynthetic-3',duration,language:'zh'})
  assert.equal(speech.snapshot().selection.providerId,'synthetic-cloud')
  report.conversion={resampled:true,unicodePath:true,chunkDurations:chunks.slice(),duration,timestamps:false}
  const limited=createDshTranscriptionProvider({speechToText:speech,ffmpegPath,maxDurationSeconds:1})
  await assert.rejects(()=>limited.transcribe({inputPath,directory:output}),/duration limit/)
  assert.equal(chunks.length,3)
  report.durationLimitRejectedBeforeInference=true
  const stale=speech.resolve({audio:new Uint8Array(),providerId:'sensevoice-local',language:'zh'})
  await unregister()
  let received
  const entered=new Promise(resolve=>{received=resolve})
  unregister=speech.register({info:stale.provider.info,transcribe(_input,signal){received();return new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true})})}})
  const pcmPath=join(output,'synthetic.wav');const shortWave=Buffer.from(wav.subarray(0,44+32000));shortWave.writeUInt32LE(shortWave.length-8,4);shortWave.writeUInt32LE(32000,40);shortWave.writeUInt32LE(16000,24);shortWave.writeUInt32LE(32000,28);await writeFile(pcmPath,shortWave)
  await assert.rejects(()=>transcribeDshWave({speechToText:speech,spec:stale,path:pcmPath,signal:new AbortController().signal}),/no longer registered/)
  report.providerReplacementRejected=true
  const controller=new AbortController(),reason=new Error('synthetic cancellation')
  const pending=transcribeDshWave({speechToText:speech,spec:speech.resolve({audio:new Uint8Array(),providerId:'sensevoice-local',language:'zh'}),path:pcmPath,signal:controller.signal})
  const rejected=assert.rejects(pending,error=>error===reason)
  await entered;controller.abort(reason);await rejected
  await unregister()
  report.cancellationJoined=true
  report.success=true
} catch(error) {
  report.error={name:error.name,message:error.message};process.exitCode=1
} finally {
  try {await ctx?.fiber.dispose()}catch(error){report.success=false;report.shutdownError=error.message;process.exitCode=1}
  report.completedAt=new Date().toISOString()
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n')
  console.log(`Speech adapter probe ${report.success?'passed':'failed'}; model inference and desktop acceptance not tested. Report: ${join(output,'report.json')}`)
}
