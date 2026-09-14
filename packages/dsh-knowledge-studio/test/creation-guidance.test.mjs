import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {readCreationGuidance} from '@eduwork/dsh-artifact-services/creation-guidance'
import {ArtifactEngine} from '../lib/artifacts.js'

test('all five Studio model requests consume the packaged conversation creation references',async t=>{
 const root=await mkdtemp(join(tmpdir(),'creation-guidance-'))
 const workspace={id:'w',title:'Synthetic'},evidence={evidenceId:'source',path:'synthetic.md',content:'Synthetic source',excerpt:'Synthetic source',lineStart:1,lineEnd:1}
 const requests=[]
 const ctx={on:()=>{},workspaceRegistry:{get:()=>workspace},agents:{get:()=>null},agentDefaultModel:{currentSelection:()=>({provider:'fixture',model:'fixture'})},llm:{stream:async function*(request){requests.push(request);throw new Error('Intentional stop after request capture')}}}
 const manager={status:async()=>({indexed:true}),searchDetailed:async()=>({results:[evidence]}),sample:async()=>[evidence]}
 const engine=new ArtifactEngine(ctx,manager,{artifactPath:join(root,'artifacts.json')});t.after(()=>engine.close())
 for(const [kind,skill]of Object.entries({report:'documents',table:'spreadsheets',slides:'presentations',audio:'speech',video:'video'})){
  const refs=await readCreationGuidance(kind)
  const body=await readFile(new URL(`../packages/artifact-services/skills/${skill}/SKILL.md`,import.meta.url),'utf8')
  for(const ref of refs.filter(ref=>ref.source.startsWith('skills/shared/'))){
   assert.equal(ref.markdown,await readFile(new URL('../packages/artifact-services/'+ref.source,import.meta.url),'utf8'))
   assert.ok(body.includes('../shared/references/'+ref.source.split('/').at(-1)))
  }
  const artifact=await engine.start(workspace,kind,{},'s',new AbortController().signal)
  const result=await engine.wait(artifact.id)
  assert.equal(result.status,'failed') // No export or model service is invoked by this fixture.
  const request=requests.at(-1);assert.equal(request.purpose,'knowledge-studio-'+kind)
  const encoded=JSON.stringify(request.messages)
  for(const ref of refs)assert.ok(encoded.includes(JSON.stringify(ref.markdown).slice(1,-1)),ref.source)
 }
 assert.equal(requests.length,5)
 const controller=new AbortController();controller.abort()
 await assert.rejects(readCreationGuidance('report',{signal:controller.signal}),{name:'AbortError'})
 assert.deepEqual(await readCreationGuidance('../private'),[])
})
