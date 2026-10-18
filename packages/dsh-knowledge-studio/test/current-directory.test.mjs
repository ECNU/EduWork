import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,realpath,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {installImageTools} from '../packages/artifact-services/lib/image-tools.js'
import {ImageService} from '../packages/artifact-services/lib/images.js'
import {installTranscriptionTools} from '../packages/artifact-services/lib/transcription-tools.js'

test('relative image and audio inputs follow cwd without expanding project boundaries',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'artifact-cwd-'))),child=join(root,'child'),outside=await realpath(await mkdtemp(join(tmpdir(),'artifact-outside-')))
  await mkdir(child)
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6WQAAAABJRU5ErkJggg==','base64')
  for(const dir of [root,child,outside]) {await writeFile(join(dir,'image.png'),png);await writeFile(join(dir,'audio.wav'),Buffer.from('RIFF0000WAVEfmt '))}
  let cwd=child,imageRequest,audioRequest
  const tools=new Map(),session={id:'s',header:{cwd:root}},exec={agent:{session},signal:new AbortController().signal}
  const ctx={tools:{register:tool=>tools.set(tool.name,tool)},on(){},get:name=>name==='workingDirectory'?{get:s=>{assert.equal(s,session);return cwd}}:undefined,
    fs:{resolve:async(path,{cwd})=>resolve(cwd,path),processPath:path=>path}}
  const images=new ImageService()
  images.register({id:'test',generate(){throw new Error('must not generate')},capabilities:{edit:true,editMaxImages:1},async edit(request){imageRequest=request;return {path:join(root,'image.png')}}})
  installImageTools(ctx,{images})
  installTranscriptionTools(ctx,{transcription:{list:async()=>[{id:'test',available:true}],async transcribe(request){audioRequest=request;return {text:'synthetic'}}}})
  await tools.get('image_edit').execute({provider:'test',prompt:'edit',images:['image.png']},exec)
  assert.equal(imageRequest.images[0],join(child,'image.png'))
  assert.equal(imageRequest.projectPath,root)
  await tools.get('speech_transcribe').execute({provider:'test',input_path:'audio.wav'},exec)
  assert.equal(audioRequest.inputPath,join(child,'audio.wav'))
  assert.ok(audioRequest.directory.startsWith(root))
  cwd=outside
  await assert.rejects(tools.get('image_edit').execute({provider:'test',prompt:'edit',images:['image.png']},exec),/outside workspace/)
  await assert.rejects(tools.get('speech_transcribe').execute({provider:'test',input_path:'audio.wav'},exec),/outside workspace/)
  assert.deepEqual(await readFile(join(outside,'image.png')),png)
})
