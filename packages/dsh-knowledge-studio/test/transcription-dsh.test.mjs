import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDshTranscriptionProvider,transcribeDshWave} from '../packages/artifact-services/lib/transcription-dsh.js'
import {run} from '../packages/artifact-services/lib/transcription-local.js'

function fixtureWave(pcm) {
  const data=Buffer.alloc(44+pcm.length)
  data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8)
  data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22)
  data.writeUInt32LE(16000,24);data.writeUInt32LE(32000,28)
  data.writeUInt16LE(2,32);data.writeUInt16LE(16,34)
  data.write('data',36);data.writeUInt32LE(pcm.length,40);pcm.copy(data,44)
  return data
}

const sample=async(t,bytes)=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-asr-test-')),path=join(root,'audio.wav')
  t.after(()=>rm(root,{recursive:true,force:true}))
  if(bytes)await writeFile(path,fixtureWave(bytes))
  return {root,path}
}
const provider={info:{id:'sensevoice-local',location:'host-local'}}
const spec={provider,language:'zh',audio:new Uint8Array()}
const signal=()=>new AbortController().signal
const view=(phase='ready',location='host-local')=>({id:'sensevoice-local',location,languages:['auto','zh','en'],preparation:{phase}})

test('DSH adapter only admits a prepared local provider, without preparing or switching selection',async()=>{
  let state=view(),calls=0
  const speechToText={snapshot:()=>({providers:[state],selection:{providerId:'cloud'}}),resolve(){calls++},transcribe(){calls++},prepare(){calls++}}
  const adapter=createDshTranscriptionProvider({speechToText,ffmpegPath:process.execPath})
  assert.equal(adapter.local,true);assert.equal(adapter.timestamps,false)
  for(const phase of ['ready','standby','waking']) {state=view(phase);assert.equal(await adapter.available(),true)}
  for(const phase of ['unprepared','downloading','checking','loading','cancelled','failed']) {state=view(phase);assert.equal(await adapter.available(),false)}
  state=view('ready','cloud');assert.equal(await adapter.available(),false)
  await assert.rejects(()=>adapter.transcribe({}),/not ready/)
  assert.equal(calls,0)
})

test('unsupported languages fail before conversion; regional hints pin the local provider',async t=>{
  const {root}=await sample(t),requests=[]
  const speechToText={snapshot:()=>({providers:[view()]}),resolve:request=>{requests.push(request);return {...spec,language:request.language}},transcribe(){assert.fail('invalid input must not reach inference')}}
  const adapter=createDshTranscriptionProvider({speechToText,ffmpegPath:process.execPath})
  await assert.rejects(()=>adapter.transcribe({language:'fr'}),/does not support/)
  assert.equal(requests.length,0)
  await assert.rejects(()=>adapter.transcribe({language:'zh-CN',inputPath:join(root,'missing.wav')}),/ENOENT/)
  assert.equal(requests[0].providerId,'sensevoice-local');assert.equal(requests[0].language,'zh')
  speechToText.resolve=()=>({provider:{info:{id:'sensevoice-local',location:'cloud'}}})
  await assert.rejects(()=>adapter.transcribe({}),/requires a local provider/)
  assert.deepEqual(await readdir(root),[])
})

test('long WAV is sent in bounded canonical WAV chunks, in order, to one pinned provider',async t=>{
  // 121 seconds exceeds the upstream single-request 4 MiB limit.
  const pcm=Buffer.alloc(121*32000)
  for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE((i/2)%30000,i)
  const {path}=await sample(t,pcm),chunks=[]
  const speechToText={async transcribe(request,caller){
    assert.equal(request.provider,provider);assert.equal(request.language,'zh');assert.equal(caller,abort)
    const data=request.audio
    assert.ok(data.length<=60*32000+44);assert.equal(data.toString('ascii',0,4),'RIFF')
    assert.equal(data.toString('ascii',8,16),'WAVEfmt ');assert.equal(data.readUInt32LE(16),16)
    assert.equal(data.readUInt16LE(20),1);assert.equal(data.readUInt16LE(22),1)
    assert.equal(data.readUInt32LE(24),16000);assert.equal(data.readUInt32LE(28),32000)
    assert.equal(data.readUInt16LE(32),2);assert.equal(data.readUInt16LE(34),16)
    assert.equal(data.toString('ascii',36,40),'data')
    assert.equal(data.readUInt32LE(4),data.length-8);assert.equal(data.readUInt32LE(40),data.length-44)
    chunks.push(data.subarray(44));return {text:`片段${chunks.length}`,audioSeconds:(data.length-44)/32000,inferenceSeconds:0}
  }},abort=signal()
  const result=await transcribeDshWave({speechToText,spec,path,signal:abort})
  assert.deepEqual(Buffer.concat(chunks),pcm)
  assert.deepEqual(result,{text:'片段1\n片段2\n片段3',duration:121,language:'zh'})
  assert.equal('segments' in result,false)
})

test('silence has empty text and no invented language or segments',async t=>{
  const {path}=await sample(t,Buffer.alloc(32000))
  const result=await transcribeDshWave({speechToText:{transcribe:async()=>({text:' ',audioSeconds:1})},spec:{...spec,language:'auto'},path,signal:signal()})
  assert.deepEqual(result,{text:'',duration:1})
})

test('oversized or malformed WAV fails before inference, without partial success',async t=>{
  const {path}=await sample(t,Buffer.alloc(32002)),speechToText={transcribe(){assert.fail('must not infer')}}
  await assert.rejects(()=>transcribeDshWave({speechToText,spec,path,signal:signal(),maxDurationSeconds:1}),/duration limit/)
  for(const size of [0,1,3]) {
    await writeFile(path,fixtureWave(Buffer.alloc(size)))
    await assert.rejects(()=>transcribeDshWave({speechToText,spec,path,signal:signal()}),/Invalid.*WAV/)
  }
  for(const chunkSeconds of [0,121,1.5])assert.throws(()=>createDshTranscriptionProvider({speechToText:{snapshot(){},resolve(){},transcribe(){}},chunkSeconds}),/chunk duration/)
})

test('failed or cancelled chunks never return a partial transcript or retry elsewhere',async t=>{
  const {path}=await sample(t,Buffer.alloc(3*32000))
  for(const cancel of [false,true]) {
    const controller=new AbortController(),reason=new Error('stop recognition');let calls=0
    const speechToText={async transcribe(){
      calls++;if(calls===2) {if(cancel)controller.abort(reason);else throw reason}
      return {text:'partial',audioSeconds:1}
    }}
    await assert.rejects(()=>transcribeDshWave({speechToText,spec,path,signal:controller.signal,chunkSeconds:1}),error=>error===reason)
    assert.equal(calls,2)
  }
  const controller=new AbortController();controller.abort()
  await assert.rejects(()=>transcribeDshWave({speechToText:{},spec,path,signal:controller.signal}),{name:'AbortError'})
})

test('provider duration mismatches do not masquerade as complete transcription',async t=>{
  const {path}=await sample(t,Buffer.alloc(32000))
  for(const audioSeconds of [undefined,NaN,0,2])await assert.rejects(()=>transcribeDshWave({speechToText:{transcribe:async()=>({text:'bad',audioSeconds})},spec,path,signal:signal()}),/invalid audio duration/)
})

test('local child cancellation joins the process and closes diagnostics before rejecting',async t=>{
  const {root}=await sample(t),controller=new AbortController(),reason=new Error('cancel conversion')
  const child=run(process.execPath,['-e','setInterval(()=>{},1000)'],root,'convert',controller.signal)
  let timer=setTimeout(()=>controller.abort(reason),250)
  try {await assert.rejects(()=>child,error=>error===reason)}finally {clearTimeout(timer)}
  const receipt=JSON.parse(await readFile(join(root,'convert.process.json'),'utf8'))
  assert.equal(receipt.cancelled,true);assert.ok(receipt.finishedAt)
  assert.throws(()=>process.kill(receipt.pid,0))
})
