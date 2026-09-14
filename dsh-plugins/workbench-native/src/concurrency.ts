import React, {useEffect, useState, useSyncExternalStore} from 'react'
const h=React.createElement

export function ConcurrencySettings({scope}) {
 const snapshot=useSyncExternalStore(listener=>scope.subscribe(listener),()=>scope.getSnapshot(),()=>scope.getSnapshot())
 const limit=snapshot.value?.maxConcurrentRequests
 const [draft,setDraft]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('')
 useEffect(()=>{if(limit!==undefined)setDraft(String(limit))},[limit])
 const value=Number(draft),valid=draft.trim()!==''&&Number.isSafeInteger(value)&&value>=1&&value<=64
 const save=async()=>{
  if(!valid||saving)return
  setSaving(true);setError('')
  try{await scope.set('maxConcurrentRequests',value);const next=scope.getSnapshot();if(next.status!=='ready'||next.value?.maxConcurrentRequests!==value)throw Error('并发设置未保存，请重试。')}
  catch(e){setError(e.message)}finally{setSaving(false)}
 }
 const control={padding:'8px 12px',border:'1px solid var(--dsw-alias-border-l2, #ddd)',borderRadius:8,background:'var(--dsw-alias-bg-layer-1, #fff)',color:'inherit',fontSize:13}
 return h('section',{'data-eduwork-concurrency':true,style:{padding:'16px 0',borderBottom:'1px solid var(--dsw-alias-border-l2, #ddd)'}},
  h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16}},
   h('div',null,h('div',{style:{fontSize:14}},'模型请求总并发'),
    h('p',{style:{margin:'4px 0 0',fontSize:12,color:'var(--dsw-alias-label-secondary)',lineHeight:1.55}},limit===undefined?'正在读取并发设置…':`当前客户端的主会话和子代理共用上限，同时最多 ${limit} 个模型请求。`)),
   h('form',{style:{display:'flex',gap:8,alignItems:'center'},onSubmit:e=>{e.preventDefault();void save()}},
    h('input',{type:'number',min:1,max:64,step:1,'aria-label':'模型请求总并发',value:draft,disabled:saving||limit===undefined,style:{...control,width:64},onChange:e=>setDraft(e.target.value)}),
    h('button',{type:'submit',disabled:saving||snapshot.status!=='ready'||!valid||value===limit,style:{...control,whiteSpace:'nowrap',cursor:'pointer'}},saving?'保存中…':'保存'))),
  h('p',{style:{margin:'8px 0 0',fontSize:12,color:'var(--dsw-alias-label-secondary)',lineHeight:1.55}},'超出的模型请求排队；代理任务数可以更多。保存后生效，已运行的请求会正常完成。'),
  error&&h('p',{role:'alert',style:{fontSize:12,color:'var(--dsw-alias-state-error-primary, #a82332)'}},error))
}
