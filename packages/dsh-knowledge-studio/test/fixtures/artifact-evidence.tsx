import React,{useState,useSyncExternalStore} from 'react'
import {createRoot} from 'react-dom/client'
import {apply} from '../../src/client/index'
import {BUILTIN_CAPABILITIES} from '../../lib/capabilities'

const listeners=new Set<()=>void>(),seats=new Map<string,any>();let revision=0
const emit=()=>{revision++;listeners.forEach(fn=>fn())}
const listState={current:'artifact-session',byId:{'artifact-session':{cwd:'/synthetic-artifacts',blank:false}}}
const list={getSnapshot:()=>listState,subscribe:()=>()=>{}}
let preferredOpen=false,retiredCalls:string[]=[],submissions=0,draft='保留我的未发送草稿',opened:string[]=[]
const citation={evidenceId:'source-one',path:'资料/规则.md',locator:'line',lineStart:3,lineEnd:9}
const evidence={...citation,heading:'参考资料',fresh:false,content:'# 引用资料标题\n\n## 范围与说明\n\n- 第一项\n- 第二项\n\n| 字段 | 定义 |\n| --- | --- |\n| 状态 | 已核对 |\n\n```js\nconst answer = 42\n```\n\n[外部说明](https://example.org/guide)\n\n[危险链接](javascript:alert(1))\n\n![来源示意图](https://images.invalid/source.png)\n\n<img src="https://images.invalid/raw.png" onerror="window.__bad=true">\n\n<script>window.__bad=true</script>\n'}
const artifact={id:'source-report',kind:'report',title:'合成报告',status:'completed',updatedAt:new Date().toISOString(),citations:[citation],content:{sections:[{id:'section',heading:'可阅读报告',body:'成果正文仍可阅读。',evidenceIds:['source-one']}]}}
const workspace:any={id:'source-workspace',title:'合成果引用验收',path:'/synthetic-artifacts',capabilities:BUILTIN_CAPABILITIES,artifacts:[artifact]}
const ok=(value:any)=>Promise.resolve({ok:true,value})
const service=new Proxy({workspaceForPath:()=>ok({...workspace}),readArtifact:()=>ok({artifact}),readEvidence:()=>ok({evidence}),readUIPreferences:()=>ok({open:preferredOpen}),setUIOpenPreference:(open:boolean)=>{preferredOpen=open;return ok({open})}},{get(target,key){if(['prepare','wiki','search','readWikiPage','cancelTask','clear'].includes(String(key))){retiredCalls.push(String(key));throw new Error('Retired RPC requested')}return Reflect.get(target,key)}})
const ctx:any={sessions:{list},layout:{openDetails(){},closeDetails(){}},remote:{$mount:async()=>()=>{},knowledgeStudio:service,session:{openWorkspacePath:({path}:any)=>{opened.push(path);return ok({})}}},inject:(_:any,fn:any)=>fn(ctx),effect:(fn:any)=>fn(),slots:{inject:(_:any,fn:any)=>fn(),register:(options:any,component:any)=>{const key=options.name+':'+(options.id||'');seats.set(key,{options,component});emit();return()=>{seats.delete(key);emit()}}}}
await apply(ctx)
const surface=[...seats.values()].map(item=>item.options.inject?.().surface).find(Boolean)
;(window as any).sourceTest={state:()=>({preferredOpen,retiredCalls,submissions,draft,opened,reading:surface.getSnapshot().reading,memory:surface.sessionState('artifact-session')}),legacy:(view:string)=>{surface.close();surface.remember('artifact-session',{view,expanded:true,artifactId:'retired',evidence:{content:'旧 Wiki 引用'},wikiPage:{id:'retired'}});surface.enter({sessionId:'artifact-session',cwd:'/synthetic-artifacts'})}}

function Demo(){
 useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>revision)
 const [,setDraftRevision]=useState(0)
 const hooks={useSession:(select:any)=>select({sessionId:'artifact-session'}),useInput:(select:any)=>select({draft}),inputActions:{setDraft:(value:string)=>{draft=value;emit()},submit:()=>{submissions++}}}
 const seat=(item:any)=>React.createElement(item.component,{...item.options.inject?.(),...hooks,key:item.options.id||item.options.name})
 return <div style={{height:'100vh',display:'grid',gridTemplateColumns:'180px minmax(0,1fr) 390px',position:'relative',fontFamily:'Microsoft YaHei,sans-serif'}}><nav style={{padding:20}}>合成工作区</nav><main style={{padding:30}}><div style={{display:'flex',justifyContent:'flex-end'}}>{[...seats.values()].filter(item=>item.options.name==='conversation.session.header.utilities').map(seat)}</div><h1>主对话</h1><textarea aria-label="对话草稿" value={draft} onChange={event=>{draft=event.target.value;setDraftRevision(n=>n+1)}}/></main><aside style={{minHeight:0}}>{[...seats.values()].filter(item=>item.options.name==='details').map(seat)}</aside><div data-shell-overlay style={{position:'absolute',inset:0,pointerEvents:'none'}}>{[...seats.values()].filter(item=>item.options.name==='shell.overlay').map(seat)}</div></div>
}
createRoot(document.getElementById('root')!).render(<Demo/> )
