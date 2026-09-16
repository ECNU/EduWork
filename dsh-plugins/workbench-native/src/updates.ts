import React, { useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
const h = React.createElement
const accent='var(--dsw-alias-state-business-primary, #3575ef)'
const border='var(--dsw-alias-border-l2, #ddd)'
const button={padding:'8px 12px',border:`1px solid ${border}`,borderRadius:8,background:'var(--dsw-alias-bg-layer-1, #fff)',color:'inherit',cursor:'pointer',fontSize:13,whiteSpace:'nowrap' as const}
const primary={...button,background:accent,borderColor:accent,color:'#fff'}
const secondary='var(--dsw-alias-label-secondary, #777)'
const note={margin:'4px 0 0',color:secondary,fontSize:12,lineHeight:1.55}
const row={display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16}

// One native state and one poller serve the footer, modal and settings. Closing
// settings or the modal never stops a native download or loses its progress.
export function createUpdateController(service) {
 let view={status:null as any,open:false,error:'',working:''},timer:any,stopped=false,reading=false
 const listeners=new Set<()=>void>()
 const publish=patch=>{view={...view,...patch};listeners.forEach(fn=>fn())}
 const read=async()=>{if(stopped||reading)return;reading=true;try{publish({status:await service('status')})}catch(e){publish({error:e.message})}finally{reading=false}}
 const poll=async()=>{await read();if(!stopped)timer=setTimeout(poll,[view.status?.update?.state,view.status?.contentUpdate?.state].some(state=>['checking','downloading','applying'].includes(state))?350:2500)}
 const run=async(action)=>{
  if(view.working)return
  const started=Date.now(),working=action==='check-updates'?'checking':action==='download-update'?'downloading':action.startsWith('use-')?'switching':''
  publish({error:'',working})
  try{const status=await service(action);publish({status});if(status.phase==='error'&&!status.update?.error)publish({error:status.message})}catch(e){publish({error:e.message})}
  finally{if(working)await new Promise(resolve=>setTimeout(resolve,Math.max(0,450-(Date.now()-started))));await read();publish({working:''})}
 }
 void poll()
 const open=()=>{publish({open:true});if(!['downloading','ready'].includes(view.status?.contentUpdate?.state)&&(!view.status?.update||['idle','installed','up_to_date','current','error'].includes(view.status.update.state)))void run('check-updates')}
 const event=()=>open();window.addEventListener('eduwork:open-updates',event)
 return {subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},getSnapshot:()=>view,run,open,close:()=>publish({open:false}),dispose:()=>{stopped=true;clearTimeout(timer);window.removeEventListener('eduwork:open-updates',event)}}
}
function useUpdates(controller){return useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot)}
const percent=s=>s?.totalBytes>0?Math.min(100,Math.floor(s.downloadedBytes/s.totalBytes*100)):0
const size=n=>n<1048576?Math.ceil(Math.max(0,n||0)/1024)+' KB':(Math.max(0,n||0)/1048576).toFixed(1)+' MB'
function ContentPanel({controller,content:c,working}) {
 if(!c?.enabled)return null
 const progress=percent(c)
 const message=c.state==='available'?`发现内容更新 r${c.latestRevision} · ${size(c.totalBytes)}`:c.state==='checking'?'正在检查内容更新…':c.state==='downloading'?'正在下载内容更新…':c.state==='ready'?'已下载并校验，下次启动生效。':c.state==='requires_software'?'此内容更新需要先升级到兼容的软件版本。':c.state==='error'?c.message:'当前内容已是最新版本'
 return h('div',{'data-eduwork-content-update':true,style:{marginTop:16,paddingTop:16,borderTop:`1px solid ${border}`}},
  h('div',{style:{fontSize:14}},c.configuration?(c.skills?'配置与 Skills 更新':'配置更新'):'Skills 更新'),
  h('p',{style:note},[c.configuration&&`配置 ${c.configurationRevision?`r${c.configurationRevision}`:'随软件内置'}`,c.skills&&`Skills ${c.skillsRevision?`r${c.skillsRevision}`:'随软件内置'}`].filter(Boolean).join(' · ')),
  h('p',{role:c.state==='error'?'alert':'status',style:{...note,marginTop:8,overflowWrap:'anywhere',...(c.state==='error'?{color:'var(--dsw-alias-state-error-primary, #a82332)'}:{})}},message),
  c.message&&c.state==='current'&&h('p',{style:note},c.message),
  c.state==='downloading'&&h(React.Fragment,null,
   h('div',{role:'progressbar','aria-label':'内容下载进度','aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':progress,style:{height:6,marginTop:10,borderRadius:999,overflow:'hidden',background:border}},h('div',{style:{width:`${progress}%`,height:'100%',background:accent}})),
   h('p',{style:note},`${size(c.downloadedBytes)} / ${size(c.totalBytes)} · ${progress}%`)),
  ['available','ready'].includes(c.state)&&h('div',{style:{display:'flex',justifyContent:'flex-end',marginTop:10}},h('button',{type:'button',disabled:Boolean(working),style:primary,onClick:()=>controller.run(c.state==='available'?'download-content-update':'restart-content-update')},c.state==='available'?'下载内容更新':'重启使内容生效')),
  c.state==='ready'&&h('p',{style:note},'可以继续使用；重启前请先完成正在运行的任务。'))
}
export function UpdatePanel({controller}) {
 const {status,error,working}=useUpdates(controller),s=status?.update,c=status?.contentUpdate,state=working||s?.state||status?.phase
 const busy=['checking','downloading','applying','switching'].includes(state)
 const enabled=status&&status.shell!=='web'&&(s?.enabled!==false||c?.enabled)
 const policy=s?.policy||c?.policy||'stable',locked=busy||state==='ready'||['checking','downloading','ready'].includes(c?.state)
 const channels=[['stable','仅公测版'],['development','开发版']]
 const setPolicy=async value=>{if(locked||value===policy)return;await controller.run(value==='development'?'use-development-updates':'use-stable-updates');await controller.run('check-updates')}
 const progress=percent(s),determinate=state==='downloading'&&s?.totalBytes>0
 const message=state==='available'?`发现新版本 ${s.latestVersion}`:state==='downloading'?`正在下载 ${s.latestVersion}`:state==='checking'?'正在检查更新…':state==='switching'?'正在切换更新渠道…':state==='applying'?'正在退出并安装更新…':state==='installed'?'更新已完成':state==='up_to_date'?'当前已是最新版本':null
 // Restore the 0.2 settings layout while sharing native state across both shells.
 // Status-specific content expands below the channel buttons, never in a second UI.
 return h('div',{'data-eduwork-update-panel':true},
  h('div',{style:row},
   h('div',{style:{minWidth:0}},
    h('div',{style:{fontSize:14}},'自动更新'),
    h('p',{style:{...note,overflowWrap:'anywhere'}},status?.version?`当前版本 ${status.version}`:'读取当前版本…'),
    h('p',{style:note},enabled?'启动时在后台检查，发现新版本后在左下角提示。':status?'当前未启用自动更新。':'正在读取更新状态…')),
   h('button',{type:'button',style:{...button,flexShrink:0},disabled:locked||!enabled,onClick:()=>controller.run('check-updates')},state==='checking'?'检查中…':'检查更新')),
  enabled&&s&&h(React.Fragment,null,
   h('div',{role:'radiogroup','aria-label':'更新渠道',style:{display:'flex',gap:8,marginTop:12}},
    ...channels.map(([value,label],index)=>h('button',{
     key:value,type:'button',role:'radio','aria-checked':policy===value,'aria-disabled':locked,tabIndex:policy===value?0:-1,
     style:{...(policy===value?primary:{...button,background:'transparent'}),cursor:locked?'default':'pointer',opacity:locked?0.7:1},onClick:()=>setPolicy(value),
     onKeyDown:e=>{if(locked||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?1:1-index;e.currentTarget.parentElement.children[next].focus();void setPolicy(channels[next][0])},
    },label))),
   h('p',{style:{...note,marginTop:8}},policy==='development'?'接收开发版及更新的公测版。':'仅接收公测版；切换渠道不会降级。')),
  message&&s?.enabled!==false&&h('div',{style:{...row,alignItems:'center',marginTop:12}},
   h('span',{role:'status','aria-live':'polite',style:{fontSize:12,color:secondary}},message),
   state==='available'&&s&&h('button',{type:'button',style:primary,onClick:()=>controller.run('download-update')},'下载更新')),
  s?.enabled!==false&&['checking','downloading','applying'].includes(state)&&h('div',null,
   h('style',null,'@keyframes eduwork-update-progress{from{transform:translateX(-100%)}to{transform:translateX(334%)}}[data-eduwork-update-indeterminate]{animation:eduwork-update-progress 1.4s linear infinite}@media(prefers-reduced-motion:reduce){[data-eduwork-update-indeterminate]{animation:none}}'),
   h('div',{role:'progressbar','aria-label':state==='downloading'?'更新下载进度':'更新处理进度','aria-valuemin':0,'aria-valuemax':100,...(determinate?{'aria-valuenow':progress}:{}),style:{height:6,marginTop:10,overflow:'hidden',borderRadius:999,background:border}},
    h('div',{'data-eduwork-update-indeterminate':determinate?undefined:true,style:{width:determinate?`${progress}%`:'30%',height:'100%',borderRadius:999,background:accent,transition:determinate?'width .2s ease':undefined}})),
   state==='downloading'&&h('div',{style:{...row,marginTop:6,fontSize:11,color:secondary,fontVariantNumeric:'tabular-nums'}},
    h('span',{style:{minWidth:0,overflowWrap:'anywhere'}},s?.fileName||'正在下载发行包'),
    h('span',{style:{flexShrink:0}},determinate?`${size(s.downloadedBytes)} / ${size(s.totalBytes)} · ${progress}%`:'正在连接…')),
   state==='downloading'&&h('p',{style:note},'下载期间可以继续对话，关闭此面板不影响下载。')),
  state==='ready'&&h('div',{style:{marginTop:12,padding:11,border:`1px solid ${border}`,borderRadius:10}},
   h('p',{role:'status',style:{margin:0,fontSize:12}},s.installOnNextStart?`版本 ${s.latestVersion} 已校验，将在下次启动时安装。`:`版本 ${s.latestVersion} 已下载并校验。`),
   h('p',{style:note},'可继续使用当前版本。重启安装前，请先完成正在运行的任务。'),
   h('div',{style:{display:'flex',justifyContent:'flex-end',flexWrap:'wrap',gap:8,marginTop:10}},
    !s.installOnNextStart&&h('button',{type:'button',style:button,onClick:()=>controller.run('schedule-update')},'下次启动时安装'),
    h('button',{type:'button',style:primary,onClick:()=>controller.run('install-update')},'立即重启更新'))),
  !busy&&(error||s?.error)&&h('p',{role:'alert',style:{...note,marginTop:12,color:'var(--dsw-alias-state-error-primary, #a82332)',overflowWrap:'anywhere'}},error||s.error),
  h(ContentPanel,{controller,content:c,working}),
  status?.url&&h('a',{href:status.url,target:'_blank',rel:'noopener noreferrer',style:{...button,display:'inline-block',marginTop:12}},'打开下载页面'))
}
export function UpdateFooter({controller,wide=true}) {
 const {status,open,working}=useUpdates(controller),s=status?.update,c=status?.contentUpdate,state=working||s?.state
 useEffect(()=>{if(!open)return;const key=e=>{if(e.key==='Escape')controller.close()};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[open])
 if(!status||status.shell==='web')return null
 // Keep one small blue entry; both download transactions remain in the panel.
 const softwareVisible=s?.enabled&&['available','downloading','ready','applying'].includes(state)
 const label=softwareVisible?(state==='available'?'更新':state==='downloading'?`下载 ${percent(s)}%`:state==='ready'?'重启更新':'正在更新…'):(c?.state==='downloading'?`内容 ${percent(c)}%`:c?.state==='ready'?'内容待生效':'更新')
 const visible=wide&&(softwareVisible||c?.enabled&&['available','downloading','ready','requires_software'].includes(c.state))
 return h(React.Fragment,null,
  visible&&h('button',{type:'button','aria-label':'查看更新',title:'查看软件及内容更新',onClick:controller.open,'data-eduwork-update-entry':true,'data-chatecnu-update-prompt':softwareVisible?state:c.state,style:{flex:'0 0 auto',alignSelf:'center',minWidth:42,height:28,margin:'4px 2px 4px 6px',border:0,borderRadius:999,padding:'0 11px',background:'var(--dsw-alias-state-info-primary, #4f78dd)',color:'white',cursor:'pointer',fontSize:11,fontWeight:700,whiteSpace:'nowrap',fontFamily:'system-ui, sans-serif'}},label),
  open&&createPortal(h('div',{style:{position:'fixed',inset:0,zIndex:11000,display:'grid',placeItems:'center',background:'rgba(0,0,0,.28)',backdropFilter:'blur(3px)'},onMouseDown:e=>{if(e.target===e.currentTarget)controller.close()}},
   h('section',{role:'dialog','aria-modal':true,'aria-label':'更新',style:{boxSizing:'border-box',width:'min(480px, calc(100vw - 32px))',maxHeight:'calc(100vh - 48px)',overflowY:'auto',padding:24,border:`1px solid ${border}`,borderRadius:16,background:'var(--dsw-alias-bg-layer-1, #fff)',color:'var(--dsw-alias-label-primary, #222)',boxShadow:'0 20px 70px #0003'}},
    h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}},h('h2',{style:{fontSize:20,margin:0}},'更新'),h('button',{type:'button','aria-label':'关闭更新面板',onClick:controller.close,style:button},'×')),
    h(UpdatePanel,{controller}))),document.body))
}

