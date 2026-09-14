// Synthetic persisted conversation for isolated hosts; never sends an LLM prompt.
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'

export async function seedHostSession(runtime,home) {
  const root=join(home,'sessions'),workspace=join(home,'synthetic-workspace')
  await mkdir(root) // Refuse an existing session store.
  await mkdir(workspace)
  await writeFile(join(workspace,'readme.md'),'# Synthetic Studio sources\nLocal toolbar acceptance; no model request.\n')
  const require=createRequire(join(runtime,'package.json'))
  const load=name=>import(pathToFileURL(require.resolve(name)))
  const {Context}=await load('@deepseek-ai/cordis')
  const {default:Jsonl}=await load('@deepseek-ai/dsh-session-persistence-jsonl')
  const {default:SessionStore,SessionId,SessionSeq,SESSION_FORMAT_VERSION}=await load('@deepseek-ai/dsh-session')
  const {createUserMessage}=await load('@deepseek-ai/dsh-llm')
  const context=new Context(),now=Date.now(),sessionId='studio-toolbar-fixture'
  const title='Studio 顶部工具栏验收：用于检查按钮与长会话标题是否冲突的合成对话'
  try {
    if(Jsonl.inject?.includes('sessions'))await context.plugin(SessionStore)
    await context.plugin(Jsonl,{root})
    const writer=await context.sessionPersistence.create({version:SESSION_FORMAT_VERSION,id:SessionId(sessionId),createdAt:now,cwd:workspace,isSeeded:false})
    try {
      const events=[
        {type:'turn/start',seq:SessionSeq(0),time:now,data:{turn:1}},
        {type:'user/message',seq:SessionSeq(1),time:now+1,surfaceOp:'append',data:createUserMessage({content:[{type:'text',text:'本地合成记录：验证 Studio 顶部入口，没有发起模型请求。'}],source:{kind:'user'}})},
        {type:'turn/end',seq:SessionSeq(2),time:now+2,data:{turn:1,reason:{kind:'completed'}}},
        {type:'session/title',seq:SessionSeq(3),time:now+3,data:{title,messageSeqs:[SessionSeq(1)],source:{kind:'fallback'}}},
      ]
      if(writer)await writer.append(events)
      else await context.sessionPersistence.append(SessionId(sessionId),events)
    } finally {await writer?.close()}
  } finally {await context.fiber.dispose()}
  const fixture={workspace,sessionId,title,synthetic:true,modelCalls:0}
  await writeFile(join(home,'fixture.json'),JSON.stringify(fixture,null,2))
  return fixture
}
