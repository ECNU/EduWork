import {test} from 'node:test'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {join} from 'node:path'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {Connections} from '../src/connections.js'
const require = createRequire(import.meta.url)
const load = name => import(pathToFileURL(require.resolve('@deepseek-ai/'+name)))

test('official DSH providers, tools and storage support independent connections and restart', async () => {
  const ctx = new Context(), fibers=[]
  const root = await mkdtemp(join(tmpdir(), 'eduwork-agent-pr-'))
  const mount = async (name, options={}) => {const module = await load(name); const fiber=ctx.plugin(module.default ?? module, options);fibers.push(fiber);await fiber}
  try {
    // No task is started: cwd service is needed only as a registration dependency.
    ctx.provide('workingDirectory', {})
    for (const name of ['dsh-system-prompt','dsh-tools','dsh-session-projection','dsh-subagent','dsh-subprocess-local','dsh-storage']) await mount(name)
    await mount('dsh-storage-json', {root})
    await mount('dsh-storage-domain', {backend:'json'})
    const fiber=ctx.plugin(Connections); fibers.push(fiber); await fiber
    const service=ctx.eduworkAgentConnections
    await service.ready
    let {rows}=await service.manage({op:'add',name:'Fixture A',command:process.execPath,args:['-e', `process.stdin.once('data', d=>{const r=JSON.parse(d);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{protocolVersion:1,agentCapabilities:{}}})+'\\n')})`]})
    const id=rows.find(row=>row.name==='Fixture A').id
    await service.manage({op:'check',id})
    await service.manage({op:'enable',id,enabled:true})
    assert.ok(ctx.subagents.getProvider('eduwork_'+id))
    assert.ok(ctx.tools.get('subagent_eduwork_'+id))
    const second=(await service.manage({op:'add',name:'Fixture B',command:process.execPath,args:rows.find(row=>row.id===id).args})).rows.find(row=>row.name==='Fixture B').id
    await service.manage({op:'check',id:second})
    await service.manage({op:'enable',id:second,enabled:true})
    assert.ok(ctx.tools.get('subagent_eduwork_'+second))
    assert.ok(ctx.tools.get('subagent_eduwork_'+id))
    await service.manage({op:'enable',id,enabled:false})
    assert.equal(ctx.subagents.getProvider('eduwork_'+id),undefined)
    assert.equal(ctx.tools.get('subagent_eduwork_'+id),undefined)
    assert.ok(ctx.tools.get('subagent_eduwork_'+second))
    await service.manage({op:'remove',id})
    await fiber.dispose()
    const restarted=ctx.plugin(Connections);fibers.push(restarted);await restarted
    await ctx.eduworkAgentConnections.ready
    assert.ok(ctx.subagents.getProvider('eduwork_'+second))
    assert.ok(ctx.tools.get('subagent_eduwork_'+second))
    assert.equal((await ctx.eduworkAgentConnections.manage({op:'list'})).rows.find(row=>row.id===second).checked,false)

  } finally {
   for(const fiber of fibers.toReversed()) await fiber.dispose()
   await rm(root,{recursive:true,force:true})
  }
})
