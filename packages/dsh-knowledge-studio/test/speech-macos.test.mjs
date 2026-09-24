import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,readdir,rm,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createMacOSSpeechProvider,parseMacVoices,runMacSpeechCommand} from '../packages/artifact-services/lib/speech-macos.js'
import {SpeechService,createSystemSpeechProvider,waveDuration} from '../packages/artifact-services/lib/speech.js'
import {createMediaProviders} from '../packages/artifact-services/lib/providers.js'

const catalog='Samantha             en_US    # Hello.\nTingting             zh_CN    # 你好。\nEddy (中文（中国大陆）) zh_CN # 你好。\nGood News            en_US    # Good news!\n'
const wave=()=>{
  const result=Buffer.alloc(44+1600)
  result.write('RIFF',0);result.writeUInt32LE(result.length-8,4);result.write('WAVEfmt ',8)
  result.writeUInt32LE(16,16);result.writeUInt16LE(1,20);result.writeUInt16LE(1,22)
  result.writeUInt32LE(8000,24);result.writeUInt32LE(16000,28);result.writeUInt16LE(2,32);result.writeUInt16LE(16,34)
  result.write('data',36);result.writeUInt32LE(1600,40)
  return result
}
const directory=async t=>{
  const root=await mkdtemp(join(tmpdir(),'mac-speech-test-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  return root
}

test('Mac voice discovery preserves localized/multiword ids, normalizes locales and deduplicates',()=>{
  assert.deepEqual(parseMacVoices(catalog+catalog+'not a voice\n'),[
    {id:'Samantha',title:'Samantha',language:'en-US'},
    {id:'Tingting',title:'Tingting',language:'zh-CN'},
    {id:'Eddy (中文（中国大陆）)',title:'Eddy (中文（中国大陆）)',language:'zh-CN'},
    {id:'Good News',title:'Good News',language:'en-US'},
  ])
})

test('voice discovery caches successful results, returns copies and recovers from errors',async()=>{
  let attempts=0
  const provider=createMacOSSpeechProvider({run:async(command,args)=>{
    assert.equal(command,'/usr/bin/say');assert.deepEqual(args,['-v','?'])
    if(++attempts===1)throw new Error('temporary failure')
    return catalog
  }})
  await assert.rejects(()=>provider.voices(),/temporary failure/)
  const voices=await provider.voices();voices[0].id='changed'
  assert.equal((await provider.voices())[0].id,'Samantha');assert.equal(attempts,2)
  await assert.rejects(()=>provider.voices({signal:AbortSignal.abort()}),{name:'AbortError'})
  const empty=createMacOSSpeechProvider({run:async()=>''})
  await assert.rejects(()=>empty.voices(),/未找到.*音色/)
})

test('system synthesis passes exact Unicode text by file, selects Chinese, and returns measured WAV',async t=>{
  const root=await directory(t),calls=[],text='你好，EduWork。\nQuotes " \' and `$(touch nope)` stay text.'
  const service=new SpeechService()
  service.register(createMacOSSpeechProvider({run:async(command,args,options)=>{
    calls.push({command,args,options})
    if(args[0]==='-v'&&args[1]==='?')return catalog
    const input=args[args.indexOf('-f')+1],output=args[args.indexOf('-o')+1]
    assert.equal(await readFile(input,'utf8'),text)
    assert.equal(args.includes(text),false);assert.equal(args[1],'Tingting')
    assert.equal(args[args.indexOf('-r')+1],'350')
    assert.ok(args.includes('--file-format=WAVE'));assert.ok(args.includes('--data-format=LEI16@22050'))
    await writeFile(output,wave())
    return ''
  }}))
  const abort=new AbortController()
  const result=await service.synthesize({provider:'system',text,speed:2,directory:join(root,'中文 路径'),name:'speech',signal:abort.signal})
  assert.equal(result.provider,'system');assert.equal(result.voice,'Tingting');assert.equal(result.duration,.1)
  assert.equal(result.format,'wav');assert.equal(result.text,text)
  assert.equal(waveDuration(await readFile(result.path)),.1)
  const synthesis=calls.at(-1)
  assert.equal(synthesis.options.signal,abort.signal)
  await assert.rejects(()=>access(synthesis.args[synthesis.args.indexOf('-f')+1]),{code:'ENOENT'})
})

test('missing Chinese voices and removed selections fail before output, without substitution',async t=>{
  const root=await directory(t),english='Samantha en_US # Hello.\n';let current=catalog,inferences=0
  const provider=createMacOSSpeechProvider({run:async(_command,args)=>{
    if(args[1]==='?')return current
    inferences++;assert.fail('must not synthesize')
  }})
  await provider.voices();current=english
  const request={text:'中文内容',voice:'Samantha',directory:root,name:'output'}
  await assert.rejects(()=>provider.synthesize(request),/安装中文语音/)
  await assert.rejects(()=>provider.synthesize({...request,voice:'Tingting'}),/音色不可用/)
  assert.equal(inferences,0);assert.deepEqual(await readdir(root),[])
})

test('invalid requests and occupied outputs are rejected; existing files are preserved',async t=>{
  const root=await directory(t),provider=createMacOSSpeechProvider({run:async(_command,args)=>{assert.equal(args[1],'?');return catalog}})
  const request={text:'test',voice:'Samantha',directory:root,name:'speech'}
  for(const patch of [{name:'../escape'},{directory:'relative'},{format:'mp3'},{speed:0},{speed:NaN},{text:''}])await assert.rejects(()=>provider.synthesize({...request,...patch}))
  await writeFile(join(root,'speech.wav'),'existing')
  await assert.rejects(()=>provider.synthesize(request),{code:'EEXIST'})
  assert.equal(await readFile(join(root,'speech.wav'),'utf8'),'existing')
})

test('failure, invalid output and cancellation remove partial files after the runner settles',async t=>{
  const root=await directory(t)
  for(const mode of ['failure','invalid','cancel']) {
    const controller=new AbortController(),reason=new Error('stop'),paths=[]
    let settled=false
    const provider=createMacOSSpeechProvider({run:async(_command,args)=>{
      if(args[1]==='?')return catalog
      const path=args[args.indexOf('-o')+1];paths.push(path,args[args.indexOf('-f')+1])
      await writeFile(path,mode==='cancel'?wave():'invalid')
      settled=true
      if(mode==='failure')throw reason
      if(mode==='cancel')controller.abort(reason)
      return ''
    }})
    await assert.rejects(()=>provider.synthesize({text:'test',voice:'Samantha',directory:root,name:mode,signal:controller.signal}))
    assert.equal(settled,true)
    for(const path of paths)await assert.rejects(()=>access(path),{code:'ENOENT'})
  }
})

test('cancellation during voice lookup is forwarded before synthesis starts',async()=>{
  const controller=new AbortController(),reason=new Error('cancel discovery'),service=new SpeechService()
  service.register({id:'test',voices:async({signal})=>{assert.equal(signal,controller.signal);controller.abort(reason);return [{id:'voice',title:'Voice'}]},synthesize(){assert.fail('must not synthesize')}})
  await assert.rejects(()=>service.synthesize({provider:'test',text:'test',signal:controller.signal}),error=>error===reason)
})

test('native process runner waits for cancellation, preserves diagnostics and sanitizes failures',async t=>{
  const root=await directory(t),controller=new AbortController(),reason=new Error('cancel child')
  const pending=runMacSpeechCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal,directory:root})
  const timer=setTimeout(()=>controller.abort(reason),200)
  try {await assert.rejects(()=>pending,error=>error===reason)}finally {clearTimeout(timer)}
  const receipt=JSON.parse(await readFile(join(root,'speech.process.json'),'utf8'))
  assert.equal(receipt.cancelled,true);assert.ok(receipt.finishedAt)
  assert.throws(()=>process.kill(receipt.pid,0))
  await assert.rejects(()=>runMacSpeechCommand(process.execPath,['-e','process.stderr.write("private details");process.exit(1)'],{directory:root,stage:'failure'}),error=>!error.message.includes('private details'))
  assert.equal(await readFile(join(root,'failure.stderr.log'),'utf8'),'private details')
})

test('media registry enables system speech only on supported operating systems',()=>{
  const providers=createMediaProviders()
  assert.equal(providers.speechService.has('system'),['win32','darwin'].includes(process.platform))
  if(process.platform==='win32')assert.equal(createSystemSpeechProvider().title,'Windows 本地语音')
  if(process.platform==='darwin')assert.equal(createSystemSpeechProvider().title,'macOS 本地语音')
})
