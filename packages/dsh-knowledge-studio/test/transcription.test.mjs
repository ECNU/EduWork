import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,symlink,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createServer} from 'node:http'
import {TranscriptionService} from '../packages/artifact-services/lib/transcription.js'
import {createOpenAICompatibleTranscriptionProvider} from '../packages/artifact-services/lib/transcription-openai.js'
import {createWhisperCppTranscriptionProvider} from '../packages/artifact-services/lib/transcription-whisper.js'
import {installTranscriptionTools} from '../packages/artifact-services/lib/transcription-tools.js'

const sample=async()=>{const root=await mkdtemp(join(tmpdir(),'transcription-test-')),inputPath=join(root,'input.wav');await writeFile(inputPath,Buffer.alloc(44));return {root,inputPath}}
const listen=async handler=>{const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));return {baseURL:`http://127.0.0.1:${server.address().port}/v1`,close:()=>new Promise(r=>{server.closeAllConnections();server.close(r)})}}

test('transcription extensions preserve execution context, strip private fields and never fall back',async()=>{
 const {inputPath}=await sample(),service=new TranscriptionService(),execution={session:'parent'},calls=[]
 const dispose=service.register({id:'third-party',secret:'private',transcribe:async request=>{calls.push(request);return {text:'文字',segments:[{start:0,end:1,text:'文字',vendor:'hidden'}],secret:'private'}}})
 const result=await service.transcribe({provider:'third-party',inputPath,execution})
 assert.deepEqual(result,{provider:'third-party',text:'文字',segments:[{start:0,end:1,text:'文字'}]});assert.equal(calls[0].execution,execution)
 assert.ok(!JSON.stringify(await service.list()).includes('private'))
 assert.throws(()=>service.register({id:'third-party',transcribe(){}}),/Duplicate/)
 dispose();await assert.rejects(service.transcribe({provider:'third-party',inputPath}),/unavailable/);assert.equal(calls.length,1)
})

test('unprovisioned local provider reports unavailable without a download or a cloud fallback',async()=>{
 const service=new TranscriptionService();service.register(createWhisperCppTranscriptionProvider())
 assert.deepEqual(await service.list(),[{id:'whisper-cpp',title:'Local Whisper (CPU)',local:true,available:false,timestamps:true,model:'whisper-tiny-q5_1'}])
 const {inputPath}=await sample();await assert.rejects(service.transcribe({provider:'whisper-cpp',inputPath}),/not ready/)
})

test('Windows rejects an overlong native job path before creating a job or invoking a process',{skip:process.platform!=='win32'},async()=>{
 const {root,inputPath}=await sample();let directory=join(root,'long-path')
 while(join(directory,'transcription-XXXXXX','result.json').length<260)directory=join(directory,'nested')
 await mkdir(directory,{recursive:true})
 const provider=createWhisperCppTranscriptionProvider({executablePath:process.execPath,modelPath:inputPath,ffmpegPath:process.execPath})
 await assert.rejects(provider.transcribe({inputPath,directory}),/请选择较短的工作区或任务目录/)
 assert.deepEqual(await readdir(directory),[])
})

test('transcription validates real input and segment timing, allows silence, and forwards cancellation',async()=>{
 const {inputPath}=await sample(),service=new TranscriptionService();let response={text:'',segments:[]},count=0
 service.register({id:'test',transcribe:async()=>{count++;return response}})
 assert.equal((await service.transcribe({provider:'test',inputPath})).text,'')
 response={text:'bad',segments:[{start:2,end:1,text:'bad'}]};await assert.rejects(service.transcribe({provider:'test',inputPath}),/timing/)
 await assert.rejects(service.transcribe({provider:'test',inputPath:'relative.wav'}),/absolute/)
 await assert.rejects(service.transcribe({provider:'test',inputPath,language:'-f /etc/passwd'}),/language/)
 await assert.rejects(service.transcribe({provider:'test',inputPath,signal:AbortSignal.abort()}),{name:'AbortError'});assert.equal(count,2)
})

test('remote minimal JSON sends multipart file/model once, using host headers and optional language',async()=>{
 const {inputPath}=await sample(),received=[]
 const server=await listen(async(req,res)=>{const chunks=[];for await(const part of req)chunks.push(part);received.push({url:req.url,headers:req.headers,body:Buffer.concat(chunks).toString()});res.setHeader('content-type','application/json');res.end(JSON.stringify({text:'录音文字',segments:[{start:0,end:3,text:'ignored'}]}))})
 try {
  const service=new TranscriptionService(),execution={marker:1}
  service.register(createOpenAICompatibleTranscriptionProvider({baseURL:server.baseURL,model:'test-model',getHeaders:request=>{assert.equal(request.execution,execution);return {Authorization:'Bearer fixture-key','Content-Type':'incorrect'}}}))
  const result=await service.transcribe({provider:'openai-compatible',inputPath,language:'zh-CN',execution})
  assert.deepEqual(result,{text:'录音文字',provider:'openai-compatible',model:'test-model'})
  assert.equal(received.length,1);const [request]=received
  assert.equal(request.url,'/v1/audio/transcriptions');assert.equal(request.headers.authorization,'Bearer fixture-key');assert.match(request.headers['content-type'],/^multipart\/form-data; boundary=/)
  for(const pattern of [/name="file"; filename="input.wav"/,/name="model"\r\n\r\ntest-model/,/name="response_format"\r\n\r\njson/,/name="language"\r\n\r\nzh/])assert.match(request.body,pattern)
  assert.doesNotMatch(request.body,/timestamp_granularities|verbose_json/)
 }finally{await server.close()}
})

test('remote timestamps are capability opt-in; vendor errors and redirects are sanitized and never retried',async()=>{
 const {inputPath}=await sample();let mode='success',calls=0
 const server=await listen(async(req,res)=>{for await(const _ of req){}calls++;if(mode==='redirect'){res.writeHead(307,{Location:'/redirect-secret'});res.end();return}res.writeHead(mode==='error'?401:200,{'Content-Type':'application/json'});res.end(JSON.stringify(mode==='error'?{error:{message:'credential-do-not-echo'}}:{text:'hello',segments:[{start:0,end:1,text:'hello',private:true}],duration:1}))})
 try {
  const service=new TranscriptionService();service.register(createOpenAICompatibleTranscriptionProvider({baseURL:server.baseURL,model:'segments',responseFormat:'verbose_json'}))
  assert.equal((await service.list())[0].timestamps,true)
  assert.deepEqual((await service.transcribe({provider:'openai-compatible',inputPath})).segments,[{start:0,end:1,text:'hello'}])
  mode='error';await assert.rejects(service.transcribe({provider:'openai-compatible',inputPath}),/^Error: Transcription service returned HTTP 401$/)
  mode='redirect';await assert.rejects(service.transcribe({provider:'openai-compatible',inputPath}),/^Error: Remote transcription failed;/)
  assert.equal(calls,3)
 }finally{await server.close()}
})

test('remote upload limits and cancellation do not trigger another network attempt',async()=>{
 const {inputPath}=await sample();let received;const arrived=new Promise(r=>received=r)
 const server=await listen(async(req,res)=>{for await(const _ of req){}received()})
 try{
  const service=new TranscriptionService();service.register(createOpenAICompatibleTranscriptionProvider({baseURL:server.baseURL,model:'tiny-limit',maxBytes:1}))
  await assert.rejects(service.transcribe({provider:'openai-compatible',inputPath}),/oversized/)
  service.register(createOpenAICompatibleTranscriptionProvider({id:'cancel',baseURL:server.baseURL,model:'cancel'}))
  const controller=new AbortController(),pending=service.transcribe({provider:'cancel',inputPath,signal:controller.signal})
  await arrived;controller.abort();await assert.rejects(pending,{name:'AbortError'})
 }finally{await server.close()}
})

test('DSH transcription tools reject workspace escapes before touching outputs and keep one approval boundary',async()=>{
 const {root,inputPath}=await sample(),other=await sample(),service={transcription:new TranscriptionService()},registered=new Map();let before,request
 service.transcription.register({id:'local',local:true,transcribe:async value=>{request=value;return {text:'local'}}})
 const ctx={tools:{register:tool=>registered.set(tool.name,tool)},on:(_,fn)=>{before=fn},permissionPresets:{current:()=> 'workspace-write'},fs:{resolve:async(path,{cwd})=>resolve(cwd,path),processPath:path=>path}}
 installTranscriptionTools(ctx,service)
 const exec={name:'speech_transcribe',agent:{session:{id:'session',header:{cwd:root}}},signal:new AbortController().signal}
 assert.equal((await before(exec,()=>{throw new Error('not approved')})).kind,'ask')
 ctx.permissionPresets.current=()=> 'danger-full-access';assert.equal(await before(exec,()=> 'next'),'next')
 assert.equal((await before({...exec,agent:undefined},()=>{})).kind,'deny')
 const execute=registered.get('speech_transcribe').execute
 await assert.rejects(execute({input_path:other.inputPath,provider:'local'},exec),/outside workspace/)
 await symlink(other.root,join(root,'outside'),process.platform==='win32'?'junction':'dir')
 await assert.rejects(execute({input_path:'outside/input.wav',provider:'local'},exec),/outside workspace/)
 assert.ok(!(await readdir(root)).includes('.artifacts'))
 const result=await execute({input_path:inputPath,provider:'local'},exec)
 assert.equal(JSON.parse(result.reportJSON).text,'local');assert.equal(request.execution,exec);assert.equal(request.signal,exec.signal)
})
