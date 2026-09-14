import React, { useEffect, useState } from 'react'
const h = React.createElement
export function DataImportPanel({ service }) {
 const [job,setJob]=useState(null as any),[error,setError]=useState(''),[choosing,setChoosing]=useState(false)
 useEffect(()=>{let active=true,timer;const poll=async()=>{try{const next=await service.status();if(active)setJob(next)}catch(e){if(active)setError(e.message)}finally{if(active)timer=setTimeout(poll,800)}};void poll();return()=>{active=false;clearTimeout(timer)}},[service])
 const start=async()=>{setError('');setChoosing(true);try{const path=await service.pickDirectory();if(path)setJob(await service.preview(path))}catch(e){setError(e.message)}finally{setChoosing(false)}}
 const confirm=async()=>{setError('');setChoosing(true);try{setJob(await service.start(job.id))}catch(e){setError(e.message)}finally{setChoosing(false)}}
 const cancel=async()=>{setError('');try{setJob(await service.cancel())}catch(e){setError(e.message)}}
 const scanning=job?.state==='scanning',busy=choosing||scanning||job?.state==='running',button={padding:'8px 12px',border:'1px solid var(--dsw-alias-border-l2, #ddd)',borderRadius:8,background:'var(--dsw-alias-bg-layer-1, white)',color:'inherit',cursor:'pointer'}
 return h('section',{'data-eduwork-data-import':true,style:{padding:'16px 0',borderBottom:'1px solid var(--dsw-alias-border-l2, #ddd)'}},
  h('h3',{style:{fontSize:14,margin:'0 0 12px'}},'导入历史数据'),
  h('p',{style:{fontSize:13,lineHeight:1.7}},'选择旧客户端的程序根目录（包含程序和 data 文件夹）。合并会话及程序目录内的工作区、附件；重复内容跳过，冲突会话保留为副本。请先退出旧客户端。'),
  h('button',{type:'button',disabled:busy,style:button,onClick:start},scanning?'正在检查…':busy?'正在处理…':'选择旧客户端目录并检查'),
  job?.state==='ready'&&h('div',{style:{display:'flex',gap:8,marginTop:12}},h('button',{type:'button',disabled:busy||!job.total,style:button,onClick:confirm},`导入 ${job.total} 个可读会话`),h('button',{type:'button',disabled:busy,style:button,onClick:cancel},'取消')),
  (scanning||job?.state==='running')&&h('progress',{'aria-label':scanning?'兼容性检查进度':'数据导入进度',max:(scanning?job.found:job.total)||1,...((scanning?job.found:job.total)?{value:scanning?job.scanned:job.completed}:{}),style:{display:'block',width:'100%',marginTop:12,accentColor:'var(--dsw-alias-state-business-primary)'}}),
  job?.targetFormat>0&&h('p',{style:{fontSize:12}},`来源客户端：${job.sourceVersion||'未标注'}；发现会话格式：${job.formats.map(v=>`v${v}`).join('、')||'未识别'}；本机支持至 v${job.targetFormat}。兼容性以会话格式为准。`),
  job?.message&&h('p',{role:job.state==='error'?'alert':'status',style:{fontSize:13}},job.message),
  error&&h('p',{role:'alert'},error),
  job?.issues?.length>0&&h('details',{open:job.state==='ready'},h('summary',null,`无法导入（${job.issues.length} 项）`),h('ul',null,...job.issues.map((row,i)=>h('li',{key:i,style:{fontSize:12,overflowWrap:'anywhere'}},`${row.path}：${row.reason}`)))),
  job?.warnings?.length>0&&h('details',null,h('summary',null,`导入说明（${job.warnings.length} 项）`),h('ul',null,...job.warnings.map((text,i)=>h('li',{key:i,style:{fontSize:12,overflowWrap:'anywhere'}},text)))),
  job?.state==='complete'&&h('p',{style:{fontSize:12}},'导入记录已保存。完成当前任务后重新打开客户端，即可查看导入的会话。'),
  h('p',{style:{fontSize:12,color:'var(--dsw-alias-label-secondary)'}},'已有数据、模型配置和登录信息不变。跨机时，程序目录之外的项目文件需要另外复制。'))
}
