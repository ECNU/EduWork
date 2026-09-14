import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile,copyFile,readdir,mkdtemp} from 'node:fs/promises'
import {join,resolve,relative} from 'node:path'
import {cpus} from 'node:os'
import {SpeechService,createSystemSpeechProvider} from '../packages/artifact-services/lib/speech.js'
import {TranscriptionService} from '../packages/artifact-services/lib/transcription.js'
import {createWhisperCppTranscriptionProvider} from '../packages/artifact-services/lib/transcription-whisper.js'
import {createHash} from 'node:crypto'

// Explicit host-provisioned paths; this test never downloads an engine/model.
const executablePath=process.env.STUDIO_ASR_CLI,modelPath=process.env.STUDIO_ASR_MODEL
assert.ok(executablePath&&modelPath,'Set STUDIO_ASR_CLI and STUDIO_ASR_MODEL to provisioned test components')
const out=resolve(process.env.STUDIO_ASR_OUTPUT||'dist/asr');await mkdir(out,{recursive:true})
await writeFile(join(out,'process.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}))
const speech=new SpeechService();speech.register(createSystemSpeechProvider())
const voices=(await speech.list()).find(item=>item.id==='system').voices
const transcription=new TranscriptionService();transcription.register(createWhisperCppTranscriptionProvider({executablePath,modelPath,threads:4}))
const probes=[{language:'en',text:'This is a local audio transcription test. We organize documents and review the results together.',match:/local|audio|transcription/i},
 {language:'zh',text:'这是本地语音转写测试。我们整理工作区资料，检查数据质量，记录处理结果。',match:/[\u4e00-\u9fff]/}]
const results=[]
const modelHash=createHash('sha256').update(await readFile(modelPath)).digest('hex')
for(const probe of probes) {
 const voice=voices.find(item=>item.language?.startsWith(probe.language));assert.ok(voice,'Install a system test voice for '+probe.language)
 const audio=await speech.synthesize({provider:'system',voice:voice.id,text:probe.text,directory:out,name:'sample-'+probe.language})
 const started=performance.now(),result=await transcription.transcribe({provider:'whisper-cpp',inputPath:audio.path,directory:out,language:probe.language})
 const wallSeconds=(performance.now()-started)/1000
 assert.match(result.text,probe.match);assert.ok(result.segments.length>0);assert.ok(result.segments.every(segment=>segment.end>=segment.start))
 results.push({language:probe.language,source:probe.text,...result,wallSeconds,realTimeFactor:wallSeconds/result.duration})
}
const unicodeDirectory=join(out,'中文路径');await mkdir(unicodeDirectory,{recursive:true})
const unicodeModel=join(unicodeDirectory,'模型.bin'),unicodeInput=join(unicodeDirectory,'录音.wav')
await copyFile(modelPath,unicodeModel);await copyFile(join(out,'sample-en.wav'),unicodeInput)
transcription.register(createWhisperCppTranscriptionProvider({id:'unicode',executablePath,modelPath:unicodeModel,threads:4}))
const unicodeResult=await transcription.transcribe({provider:'unicode',inputPath:unicodeInput,directory:unicodeDirectory,language:'en'})
assert.match(unicodeResult.text,/local audio/i)
assert.ok(unicodeResult.segments.every(item=>item.end<=unicodeResult.duration))
for(const entry of await readdir(unicodeDirectory,{withFileTypes:true}))if(entry.isDirectory())assert.ok(!(await readdir(join(unicodeDirectory,entry.name))).includes('model.bin'),'Temporary model copy must be removed')
// Match the assembled tool's deep workspace without relying on a machine path.
let deepDirectory=join(out,'deep-workspace')
while(join(deepDirectory,'transcription-XXXXXX').length+1+relative(join(deepDirectory,'transcription-XXXXXX'),modelPath).length<300)deepDirectory=join(deepDirectory,'d')
await mkdir(deepDirectory,{recursive:true})
const deepResult=await transcription.transcribe({provider:'whisper-cpp',inputPath:unicodeInput,directory:deepDirectory,language:'en'})
assert.match(deepResult.text,/local audio/i)
const deepJobs=(await readdir(deepDirectory,{withFileTypes:true})).filter(entry=>entry.isDirectory()&&entry.name.startsWith('transcription-'))
for(const entry of deepJobs)assert.ok(!(await readdir(join(deepDirectory,entry.name))).includes('model.bin'),'Deep job must remove its model copy')
const sampleJob=join(deepDirectory,deepJobs[0].name),legacyArgument=relative(sampleJob,modelPath),legacyCombinedCharacters=sampleJob.length+1+legacyArgument.length
assert.doesNotMatch(legacyArgument,/[^\x00-\x7f]/,'Regression specifically covers an ASCII relative model path')
assert.ok(legacyCombinedCharacters>=300)
const cancelledDirectory=await mkdtemp(join(out,'cancelled-'))
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),400)
try {await assert.rejects(transcription.transcribe({provider:'whisper-cpp',inputPath:unicodeInput,directory:cancelledDirectory,language:'en',signal:controller.signal}),{name:'AbortError'})}finally{clearTimeout(timer)}
const jobs=await readdir(cancelledDirectory),cancelReceipt=JSON.parse(await readFile(join(cancelledDirectory,jobs.at(-1),'recognize.process.json'),'utf8'))
assert.equal(cancelReceipt.cancelled,true)
assert.ok(!(await readdir(join(cancelledDirectory,jobs.at(-1)))).includes('model.bin'),'Cancellation must remove the model copy')
const failedDirectory=await mkdtemp(join(out,'failed-')),invalidModel=join(failedDirectory,'invalid.bin')
await writeFile(invalidModel,'invalid model')
transcription.register(createWhisperCppTranscriptionProvider({id:'invalid-model',executablePath,modelPath:invalidModel}))
await assert.rejects(transcription.transcribe({provider:'invalid-model',inputPath:unicodeInput,directory:failedDirectory,language:'en'}),/recognize failed/)
for(const entry of await readdir(failedDirectory,{withFileTypes:true}))if(entry.isDirectory())assert.ok(!(await readdir(join(failedDirectory,entry.name))).includes('model.bin'),'Failure must remove the model copy')
assert.equal(createHash('sha256').update(await readFile(modelPath)).digest('hex'),modelHash,'The host model must remain unchanged')
const report={passed:true,engine:'whisper.cpp v1.8.3',modelSHA256:modelHash,cpu:cpus()[0].model,threads:4,externalModelCalls:false,syntheticAudio:true,unicodePaths:true,deepASCIIModelPath:{passed:true,jobCharacters:sampleJob.length,legacyCombinedCharacters},hostModelUnchanged:true,temporaryModelCleanup:true,failureCleanup:true,inFlightCancellation:true,results}
await writeFile(join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
