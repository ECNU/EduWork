import React,{useSyncExternalStore} from 'react'
import {createRoot} from 'react-dom/client'
import {apply} from '../../src/client/index'
import {BUILTIN_CAPABILITIES} from '../../lib/capabilities'

const listeners=new Set<()=>void>(),seats=new Map<string,any>();let revision=0
const emit=()=>{revision++;listeners.forEach(fn=>fn())}
const listState={current:'session',byId:{session:{cwd:'/synthetic-workspace',blank:true}}}
const list={getSnapshot:()=>listState,subscribe:()=>()=>{}}
let draft='未发送草稿'
const workspace:any={id:'workspace',title:'测试工作区',path:'/synthetic-workspace',capabilities:BUILTIN_CAPABILITIES,artifacts:[],indexed:false,consented:true,knowledgeReady:false,task:null}
const ok=(value:any)=>Promise.resolve({ok:true,value})
let preferredOpen=false
const service={workspaceForPath:()=>ok({...workspace})}
const ctx:any={sessions:{list},layout:{openDetails(){},closeDetails(){}},remote:{$mount:async()=>()=>{},knowledgeStudio:service,session:{openWorkspacePath:()=>ok({})}},
 inject:(_:any,fn:any)=>fn(ctx),effect:(fn:any)=>fn(),
 slots:{inject:(_:any,fn:any)=>fn(),register:(options:any,component:any)=>{const key=options.name+':'+(options.id||'');seats.set(key,{options,component});emit();return ()=>{seats.delete(key);emit()}}}}
Object.assign(service,{readUIPreferences:()=>ok({open:preferredOpen}),setUIOpenPreference:(open:boolean)=>{preferredOpen=open;return ok({open})}})
await apply(ctx)
;(window as any).studioTest={preference:()=>preferredOpen,showAutomatically:()=>{
  const surface=[...seats.values()].map(item=>item.options.inject?.().surface).find(Boolean)
  surface.open({sessionId:'session',cwd:'/synthetic-workspace'})
},closeAutomatically:()=>{
  const surface=[...seats.values()].map(item=>item.options.inject?.().surface).find(Boolean)
  surface.close()
}}
function Demo(){
 useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>revision)
 const hooks={useSession:(select:any)=>select({sessionId:'session'}),useInput:(select:any)=>select({draft}),inputActions:{setDraft:(value:string)=>{draft=value;emit()},submit:()=>{}}}
 const seat=(item:any)=>React.createElement(item.component,{...item.options.inject?.(),...hooks,key:item.options.id||item.options.name})
 return <div style={{height:'100vh',display:'grid',gridTemplateColumns:'180px minmax(0,1fr) 390px',position:'relative',fontFamily:'sans-serif'}}>
  <nav style={{padding:20}}>工作区导航</nav><main style={{padding:30}}><h1>对话首页</h1><textarea aria-label="对话草稿" value={draft} readOnly/></main>
  <aside style={{minHeight:0}}>{[...seats.values()].filter(item=>item.options.name==='details').map(seat)}</aside>
  <div data-shell-overlay style={{position:'absolute',inset:0,pointerEvents:'none'}}>{[...seats.values()].filter(item=>item.options.name==='shell.overlay').map(seat)}</div>
 </div>
}
createRoot(document.getElementById('root')!).render(<Demo/> )
