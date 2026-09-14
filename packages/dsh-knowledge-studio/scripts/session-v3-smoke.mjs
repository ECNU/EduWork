import assert from 'node:assert/strict'
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,dirname} from 'node:path'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const resolved={}
for(const name of ['dsh-session','dsh-session-persistence-jsonl','dsh-llm','dsh-tools']){
  const entry=require.resolve('@deepseek-ai/'+name)
  let directory=dirname(entry),manifest
  for(;;){try{manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));if(manifest.name==='@deepseek-ai/'+name)break}catch{}const parent=dirname(directory);assert.notEqual(parent,directory);directory=parent}
  assert.equal(manifest.version,'0.1.5-rc.1','All imported DSH packages must be the frozen rc runtime')
  resolved[name]={entry,version:manifest.version}
}
const {Context}=await import('@deepseek-ai/cordis')
const {default:Sessions,SESSION_FORMAT_VERSION,Session,SessionId}=await import('@deepseek-ai/dsh-session')
const {default:Jsonl}=await import('@deepseek-ai/dsh-session-persistence-jsonl')
const {createUserMessage}=await import('@deepseek-ai/dsh-llm')
const {executionTurn}=await import('../lib/artifact-lifecycle.js')
const {ArtifactEngine}=await import('../lib/artifacts.js')
assert.equal(SESSION_FORMAT_VERSION,3)
const directory=resolve(process.env.STUDIO_V3_OUTPUT||'dist/session-v3');await mkdir(directory,{recursive:true})
const home=await mkdtemp(join(tmpdir(),'studio-v3-')),ctx=new Context(),storage=new Context()
let engine,writer,reader
try{
  await ctx.plugin(Sessions)
  if(Jsonl.inject?.includes('sessions'))await storage.plugin(Sessions)
  await storage.plugin(Jsonl,{root:join(home,'sessions')})
  const session=ctx.sessions.create(SessionId('studio-v3'),{meta:{cwd:home}})
  const workspace={id:'workspace',title:'Synthetic V3 workspace'}
  const evidence={evidenceId:'source',path:'source.md',content:'Synthetic source',excerpt:'Synthetic source',revisionHash:'r',excerptHash:'e',lineStart:1,lineEnd:1}
  const manager={status:async()=>({indexed:true}),searchDetailed:async()=>({results:[evidence]}),sample:async()=>[evidence],readEvidence:async()=>evidence}
  engine=new ArtifactEngine({on:ctx.on.bind(ctx),workspaceRegistry:{get:()=>workspace},agentDefaultModel:{currentSelection:()=>({provider:'fixture',model:'fixture'})},llm:{stream:async function*(){yield {type:'text-delta',index:0,text:JSON.stringify({title:'V3 artifact',nodes:[{id:'root',parentId:'',label:'Root',body:'Content',evidenceIds:['S1']}]})};yield {type:'finish',reason:{kind:'stop'}}}}},manager,{artifactPath:join(home,'artifacts.json')})
  session.append('turn/start',{turn:1})
  session.append('user/message',createUserMessage({content:[{type:'text',text:'Synthetic V3 contract test'}],source:{kind:'user'}}),{surfaceOp:'append'})
  session.append('step/start',{turn:1,step:1})
  session.append('assistant/attempt',{turn:1,step:1,stream:[{type:'text-chunks',time0:1,index:0,dt:[],texts:['attempt']}]})
  const execution={agent:{session},callId:'v3-create'}
  assert.deepEqual(executionTurn(execution),{sessionId:'studio-v3',turn:1})
  const artifact=await engine.wait((await engine.start(workspace,'mindmap',{},session.id,undefined,execution)).id)
  assert.equal(artifact.status,'completed',artifact.message)
  assert.equal((await engine.read(artifact.id)).status,'running','A V3 assistant attempt is not turn completion')
  session.append('step/end',{turn:1,step:1})
  session.append('turn/end',{turn:1,reason:{kind:'completed'}})
  await engine.close();engine=null
  const saved=JSON.parse(await readFile(join(home,'artifacts.json'),'utf8')).artifacts[0]
  assert.equal(saved.lifecycle.state,'settled');assert.equal(saved.status,'completed')
  assert.equal(executionTurn(execution),null)
  writer=await storage.sessionPersistence.create(session.header)
  await writer.append(session.snapshotEvents());await writer.flush();await writer.close();writer=null
  reader=await storage.sessionPersistence.open(session.id,'read')
  const events=(await reader.read()).events
  assert.ok(events.some(event=>event.type==='assistant/attempt'))
  assert.equal(reader.header.version,3)
  const restored=Session.create(session.id,events,reader.header)
  assert.equal(executionTurn({agent:{session:restored}}),null)
  assert.equal(restored.header.cwd,home)
  await reader.close();reader=null
  const result={passed:true,dsh:'0.1.5-rc.1',sessionFormat:3,externalModelCalls:0,resolved,checks:['real Session V3 attempt remains in open turn','production ArtifactEngine settles from actual session/event','SessionHandle append/flush/close/read round trip','restored session retains working directory and ended boundary']}
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,checks:result.checks}))
}finally{await engine?.close();await writer?.close();await reader?.close();await ctx.fiber.dispose();await storage.fiber.dispose()}
