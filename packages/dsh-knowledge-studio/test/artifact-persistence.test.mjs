import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,readdir,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {writeAtomicJSON} from '../lib/atomic-json.js'
import {ArtifactStore,ArtifactEngine} from '../lib/artifacts.js'
const busy=()=>Object.assign(new Error('Synthetic Windows reader lock'),{code:'EPERM'})
const temporary=async()=>{const root=await mkdtemp(join(tmpdir(),'artifact-persistence-'));return {root,path:join(root,'artifacts.json')}}

test('atomic replacement retries transient Windows locks, preserves old bytes and cleans failed temporary files',async()=>{
 const {root,path}=await temporary();await writeAtomicJSON(path,{value:'old'})
 let attempts=0;const delays=[]
 await writeAtomicJSON(path,{value:'new'},{wait:async ms=>delays.push(ms),renameFile:async(from,to)=>{if(++attempts<4){assert.equal(JSON.parse(await readFile(to,'utf8')).value,'old');throw busy()}await rename(from,to)}})
 assert.deepEqual(delays,[50,100,200]);assert.equal(JSON.parse(await readFile(path,'utf8')).value,'new')
 attempts=0
 await assert.rejects(writeAtomicJSON(path,{value:'lost'},{wait:async()=>{},renameFile:async()=>{attempts++;throw busy()}}),e=>e.persistenceFailure&&e.code==='EPERM')
 assert.equal(attempts,8);assert.equal(JSON.parse(await readFile(path,'utf8')).value,'new')
 assert.deepEqual(await readdir(root),['artifacts.json'])
 attempts=0
 await assert.rejects(writeAtomicJSON(path,{value:'lost'},{renameFile:async()=>{attempts++;throw Object.assign(new Error('disk full'),{code:'ENOSPC'})}}),{code:'ENOSPC'})
 assert.equal(attempts,1);assert.deepEqual(await readdir(root),['artifacts.json'])
})

test('failed revision start is transactional; reads see committed state and same target can retry',async()=>{
 const {path}=await temporary();let blocked=false,release,entered
 const store=new ArtifactStore(path,{writeState:async(p,state)=>{
  if(blocked){entered();await new Promise(r=>{release=r});throw busy()}
  await writeAtomicJSON(p,state)
 }})
 const workspace={id:'w',title:'Synthetic'},turn={turn:1,targetKey:'one'}
 const initial=await store.create(workspace,'slides',{},'s',turn)
 await store.update(initial.id,{status:'completed',content:{title:'Keep me'},exports:[{path:'original.pptx'}]})
 const before=await store.read(initial.id),bytes=await readFile(path)
 const started=new Promise(r=>{entered=r});blocked=true
 const revision=store.create(workspace,'slides',{},'s',turn,initial.id)
 await started
 assert.deepEqual(await store.read(initial.id),before)
 release();await assert.rejects(revision,{code:'EPERM'})
 assert.deepEqual(await store.read(initial.id),before);assert.deepEqual(await readFile(path),bytes)
 blocked=false
 const next=await store.create(workspace,'slides',{},'s',turn,initial.id)
 assert.equal(next.id,initial.id);assert.equal(next.version,2);assert.equal(next.attempts[0].status,'completed')
})

test('executing task storage failure settles in memory visibly, retries after unlock and persists recovery',async t=>{
 const {path}=await temporary();let blocked=false,calls=0
 const workspace={id:'w',title:'Synthetic'},evidence={evidenceId:'e',path:'synthetic.md',content:'Synthetic content'}
 const session={id:'s',snapshotEvents:()=>[{type:'turn/start',data:{turn:1}}]}
 const ctx={on:()=>{},workspaceRegistry:{get:()=>workspace},agents:{get:()=>null},agentDefaultModel:{currentSelection:()=>({provider:'fixture',model:'fixture'})},llm:{stream:async function*(){calls++;if(calls===1)blocked=true;yield {type:'text-delta',index:0,text:JSON.stringify({title:'Synthetic map',nodes:[{id:'root',parentId:'',label:'Root'}]})};yield {type:'finish',reason:{kind:'stop'}}}}}
 const manager={status:async()=>({indexed:true}),searchDetailed:async()=>({results:[evidence]}),sample:async()=>[evidence]}
 const engine=new ArtifactEngine(ctx,manager,{artifactPath:path,writeArtifactState:async(p,state)=>{if(blocked)throw busy();await writeAtomicJSON(p,state)}});t.after(()=>engine.close())
 const start=()=>engine.start(workspace,'mindmap',{targetKey:'one'},'s',new AbortController().signal,{agent:{session}})
 const first=await start(),failed=await engine.wait(first.id)
 assert.equal(failed.status,'failed');assert.ok(failed.persistenceError)
 assert.equal((await engine.read(first.id)).status,'failed');assert.equal((await engine.list('w'))[0].status,'failed')
 assert.equal(JSON.parse(await readFile(path,'utf8')).artifacts[0].status,'running','disk is explicitly still at last committed checkpoint')
 blocked=false
 const next=await start(),done=await engine.wait(next.id)
 assert.equal(next.id,first.id);assert.equal(done.status,'completed');assert.equal(done.persistenceError,undefined)
 await engine.settleTurn('s',1,{kind:'completed'})
 const reopened=await new ArtifactStore(path).read(first.id)
 assert.equal(reopened.status,'completed');assert.equal(reopened.version,2)
 assert.equal(calls,2);assert.ok(reopened.attempts[0].message.includes('失败记录现已恢复'))
})

test('restart recovers last committed running checkpoint when terminal state could not persist',async()=>{
 const {path}=await temporary();let blocked=false
 const store=new ArtifactStore(path,{writeState:async(p,state)=>{if(blocked)throw busy();await writeAtomicJSON(p,state)}})
 const artifact=await store.create({id:'w',title:'Synthetic'},'mindmap',{})
 blocked=true;await store.failAttempt(artifact.id,{message:'task stopped'})
 assert.equal((await store.read(artifact.id)).status,'failed')
 const reopened=await new ArtifactStore(path).read(artifact.id)
 assert.equal(reopened.status,'interrupted');assert.equal(JSON.parse(await readFile(path,'utf8')).artifacts[0].status,'interrupted')
})
