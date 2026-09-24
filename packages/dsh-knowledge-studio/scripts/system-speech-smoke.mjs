// Explicit native acceptance; not part of the cross-platform unit test runner.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,readFile,readdir,writeFile,access} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {release} from 'node:os'
import {parseArgs} from 'node:util'
import {setTimeout as delay} from 'node:timers/promises'
import {createMediaProviders} from '../packages/artifact-services/lib/providers.js'
import {waveDuration} from '../packages/artifact-services/lib/speech.js'

const {values}=parseArgs({options:{output:{type:'string'}}})
if(!values.output)throw new Error('Use --output <new synthetic test directory>')
assert.ok(['win32','darwin'].includes(process.platform),'Native system speech is tested on Windows/macOS only')
const output=resolve(values.output)
await mkdir(output)
const report={startedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,osRelease:release(),node:process.version,
  success:false,scope:'native system TTS provider; synthetic text',desktopUi:'not-tested',auditoryQuality:'not-tested',cases:[]}
const inspect=async result=>{
  const bytes=await readFile(result.path)
  assert.ok(result.duration>0);assert.equal(waveDuration(bytes),result.duration)
  let samples,format
  for(let offset=12;offset+8<=bytes.length;) {
    const size=bytes.readUInt32LE(offset+4),name=bytes.toString('ascii',offset,offset+4)
    if(name==='fmt ')format={encoding:bytes.readUInt16LE(offset+8),channels:bytes.readUInt16LE(offset+10),sampleRate:bytes.readUInt32LE(offset+12),bits:bytes.readUInt16LE(offset+22)}
    if(name==='data')samples=bytes.subarray(offset+8,offset+8+size)
    offset+=8+size+size%2
  }
  assert.equal(format.encoding,1);assert.equal(format.bits,16)
  assert.ok(samples?.some(byte=>byte!==0),'System voice must produce non-silent PCM')
  return {voice:result.voice,duration:result.duration,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),...format}
}
try {
  const service=createMediaProviders().speechService
  const system=(await service.list()).find(provider=>provider.id==='system')
  assert.ok(system?.available&&system.voices.length)
  report.title=system.title;report.voices=system.voices
  const english=system.voices.find(voice=>/^en(?:-|$)/i.test(voice.language||''))
  assert.ok(english,'An installed English system voice is required')
  const directory=join(output,'中文 path with spaces')
  const text='EduWork uses the local system voice. This synthetic recording checks speech generation and the selected speaking rate.'
  const normal=await service.synthesize({provider:'system',voice:english.id,text,speed:1,directory,name:'english'})
  report.cases.push({name:'english-unicode-path',...await inspect(normal)})
  const fast=await service.synthesize({provider:'system',voice:english.id,text,speed:2,directory,name:'english-fast'})
  report.cases.push({name:'speaking-rate',...await inspect(fast)})
  assert.ok(fast.duration<normal.duration*.85,'Faster requested speech must reduce actual duration')
  const chinese=system.voices.find(voice=>/^zh(?:-|$)/i.test(voice.language||''))
  if(chinese) {
    const audio=await service.synthesize({provider:'system',text:'这是本地语音合成测试。我们整理工作区资料，检查生成的音频文件。',directory,name:'chinese'})
    assert.equal(audio.voice,chinese.id)
    report.cases.push({name:'chinese-auto-voice',...await inspect(audio)})
  } else {
    await assert.rejects(()=>service.synthesize({provider:'system',text:'这是中文语音测试。',directory,name:'chinese'}))
    report.cases.push({name:'chinese-auto-voice',status:'voice-not-installed; explicit failure verified'})
  }
  await assert.rejects(()=>service.synthesize({provider:'system',voice:'synthetic-nonexistent-voice',text:'test',directory,name:'missing'}),/音色不可用/)
  report.cases.push({name:'unknown-voice',rejected:true})
  if(process.platform==='darwin') {
    const before=await readFile(normal.path)
    await assert.rejects(()=>service.synthesize({provider:'system',voice:english.id,text,directory,name:'english'}),{code:'EEXIST'})
    assert.deepEqual(await readFile(normal.path),before)
    report.cases.push({name:'existing-output-preserved',passed:true})
    const cancelDirectory=join(output,'cancel'),controller=new AbortController(),reason=new Error('synthetic cancellation')
    const request=service.synthesize({provider:'system',voice:english.id,text:text.repeat(5000),directory:cancelDirectory,name:'cancelled',signal:controller.signal})
    let settled=false
    const outcome=request.then(value=>({value}),error=>({error})).finally(()=>{settled=true})
    let receiptPath,receipt
    const deadline=Date.now()+20000
    try {
      while(!settled&&Date.now()<deadline) {
        for(const name of await readdir(cancelDirectory).catch(()=>[])) {
          if(!name.startsWith('speech-'))continue
          const path=join(cancelDirectory,name,'speech.process.json')
          const current=await readFile(path,'utf8').then(JSON.parse).catch(()=>({}))
          if(current.status==='running') {receiptPath=path;receipt=current;break}
        }
        if(receiptPath)break
        await delay(10)
      }
      assert.ok(receiptPath,'Observe a real running say process before cancelling')
    } finally {controller.abort(reason);await outcome}
    const finished=await outcome
    assert.equal(finished.error,reason)
    const final=JSON.parse(await readFile(receiptPath,'utf8'))
    assert.equal(final.cancelled,true);assert.ok(final.finishedAt)
    assert.throws(()=>process.kill(receipt.pid,0))
    await assert.rejects(()=>access(join(cancelDirectory,'cancelled.wav')),{code:'ENOENT'})
    report.cases.push({name:'native-cancel',processJoined:true,partialOutputRemoved:true})
  }
  report.success=true
} catch(error) {report.error={name:error.name,message:error.message};process.exitCode=1}
finally {
  report.completedAt=new Date().toISOString()
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report,null,2))
}
