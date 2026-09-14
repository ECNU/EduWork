import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ArtifactEngine} from '../lib/artifacts.js'
import {installMediaTools} from '../packages/artifact-services/lib/media-tools.js'

test('dialogue media tools use the same readiness and keep plain speech independent of the renderer',async()=>{
  const tools=new Map(),service={ready:Promise.resolve(),media:{describe:async()=>({speech:[],music:[]})},mediaReadiness:async()=>({available:false,reason:'Missing renderer'})}
  installMediaTools({on(){},tools:{register(tool){tools.set(tool.name,tool)}}},service)
  const described=JSON.parse((await tools.get('speech_voices').execute({},{})).reportJSON)
  assert.equal(described.runtime.available,false)
  await assert.rejects(tools.get('media_render').execute({spec_json:JSON.stringify({kind:'video',segments:[{}]})},{}),/Missing renderer/)
  await assert.rejects(tools.get('media_render').execute({spec:{kind:'video',segments:[{}]}},{}),/Missing renderer/)
  await assert.rejects(tools.get('video_project').execute({action:'render'},{}),/Missing renderer/)
  assert.ok(tools.has('speech_synthesize'))
})

test('missing media resources or historical voice selections fail before creating a task or calling the model',async t=>{
  const root=await mkdtemp(join(tmpdir(),'studio-media-preflight-'))
  let ready=false,modelCalls=0
  const workspace={id:'workspace',path:root},ctx={
    artifactServices:{mediaReadiness:async()=>({available:ready,reason:'Missing local renderer'})},
    workspaceRegistry:{get:()=>workspace},llm:{stream(){modelCalls++;throw new Error('unexpected model call')}},
  }
  const engine=new ArtifactEngine(ctx,{}, {artifactPath:join(root,'artifacts.json'),mediaProviders:{describe:async()=>({speech:[{id:'system',available:true,voices:[{id:'current'}]}],music:[]})}})
  t.after(()=>engine.close())
  await assert.rejects(engine.start(workspace,'video',{narration:false},'session'),/Missing local renderer/)
  ready=true
  await assert.rejects(engine.start(workspace,'video',{provider:'removed-provider'},'session'),/重新选择语音服务/)
  await assert.rejects(engine.start(workspace,'audio',{voice:'removed-voice'},'session'),/重新选择音色/)
  await assert.rejects(engine.start(workspace,'audio',{},'session',AbortSignal.abort()),{name:'AbortError'})
  assert.equal(modelCalls,0)
  assert.deepEqual(await engine.list(workspace.id),[])
})
