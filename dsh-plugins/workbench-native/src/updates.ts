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
const optionRow={...row,alignItems:'center',flexWrap:'wrap' as const,gap:'8px 16px',fontSize:13,marginTop:12}

// One native state and one poller serve the footer, modal and settings. Closing
// settings or the modal never stops a native download or loses its progress.
export function createUpdateController(service) {
 let view={status:null as any,open:false,statusError:'',error:'',working:''},timer:any,stopped=false,statusRequest:any,statusRevision=0
 const waits=new Set<()=>void>()
 const listeners=new Set<()=>void>()
 const publish=patch=>{
  if(stopped)return
  if('status' in patch)statusRevision++
  view={...view,...patch};listeners.forEach(fn=>fn())
 }
 const wait=delay=>{
  let settle=()=>{}
  const promise=new Promise<boolean>(resolve=>{
   if(stopped){resolve(false);return}
   const timeout=setTimeout(()=>finish(true),delay)
   const finish=elapsed=>{clearTimeout(timeout);waits.delete(settle);resolve(elapsed)}
   settle=()=>finish(false)
   waits.add(settle)
  })
  return {promise,settle}
 }
 const read=async()=>{
  if(stopped)return
  let request=statusRequest
  if(!request){
   const revision=statusRevision
   request=Promise.resolve().then(()=>service('status')).then(status=>({ok:true,status}),error=>({ok:false,error})).then(result=>{
    if(statusRequest===request)statusRequest=null
    if(result.ok)publish({status:result.status,statusError:''})
    else if(statusRevision===revision)publish({statusError:`无法读取更新状态：${result.error?.message||String(result.error)}`})
   })
   statusRequest=request
  }
  const {promise,settle}=wait(10_000)
  const elapsed=await Promise.race([request,promise])
  settle()
  if(elapsed)publish({statusError:'无法读取更新状态：读取更新状态超时（10 秒）'})
 }
 const poll=async()=>{await read();if(!stopped)timer=setTimeout(poll,!view.statusError&&[view.status?.update?.state,view.status?.contentUpdate?.state].some(state=>['checking','downloading','verifying','applying'].includes(state))?350:2500)}
 const run=async(action)=>{
  if(view.working)return
  const started=Date.now(),working=action==='check-updates'?'checking':action==='download-update'?'downloading':action.startsWith('use-')?'switching':/^(enable|disable)-/.test(action)?'settings':''
  publish({error:'',working})
  try {
   const status=await service(action)
   publish({status})
   if(status.phase==='error'&&!status.update?.error)publish({error:status.message})
   return status.phase!=='error'&&!status.update?.error
  } catch(e) {
   publish({error:e.message})
   return false
  }
  finally{if(working)await wait(Math.max(0,450-(Date.now()-started))).promise;publish({working:''});void read()}
 }
 void poll()
 const open=()=>{publish({open:true});if(!view.statusError&&!['downloading','ready'].includes(view.status?.contentUpdate?.state)&&(!view.status?.update||['idle','installed','up_to_date','current','error'].includes(view.status.update.state)))void run('check-updates')}
 const event=()=>open();window.addEventListener('eduwork:open-updates',event)
 const close=()=>{if(view.statusError||view.status?.update?.state!=='verifying')publish({open:false})}
 return {subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},getSnapshot:()=>view,run,open,close,retry:read,dispose:()=>{stopped=true;clearTimeout(timer);waits.forEach(settle=>settle());window.removeEventListener('eduwork:open-updates',event)}}
}
function useUpdates(controller){return useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot)}
const checkboxStyle={display:'flex',gap:8,alignItems:'flex-start',marginTop:12,fontSize:13}
function updateOption({controller,action,label,description,checked,disabled}) {
 return h('label',{style:checkboxStyle},
  h('input',{type:'checkbox','aria-label':label,checked,disabled,onChange:e=>controller.run(`${e.currentTarget.checked?'enable':'disable'}-${action}`)}),
  h('span',null,label,h('span',{style:{...note,display:'block'}},description)))
}
const percent=s=>s?.downloadStage==='verifying'?(s.totalFiles>0?Math.min(100,Math.floor(s.checkedFiles/s.totalFiles*100)):0):s?.totalBytes>0?Math.min(100,Math.floor(s.downloadedBytes/s.totalBytes*100)):0
const size=n=>n<1048576?Math.ceil(Math.max(0,n||0)/1024)+' KB':(Math.max(0,n||0)/1048576).toFixed(1)+' MB'
const softwareAvailable=status=>Boolean(status&&status.shell!=='web'&&status.update?.enabled!==false)
const contentBusy=c=>['checking','downloading','ready'].includes(c?.state)

function ContentPanel({controller,content:c,working,statusError,showCheck}) {
 if(!c?.enabled)return null
 const progress=percent(c)
 const message=c.state==='available'?`发现内容更新 r${c.latestRevision} · ${size(c.totalBytes)}`:c.state==='checking'?'正在检查内容更新…':c.state==='downloading'?'正在下载内容更新…':c.state==='ready'?'已下载并校验，下次启动生效。':c.state==='requires_software'?'此内容更新需要先升级到兼容的软件版本。':c.state==='error'?c.message:'当前内容已是最新版本'
 return h('div',{'data-eduwork-content-update':true},
  h('div',{style:row},
   h('div',{style:{minWidth:0}},
    h('div',{style:{fontSize:14}},c.configuration?(c.skills?'配置与 Skills 更新':'配置更新'):'Skills 更新'),
    h('p',{style:note},[c.configuration&&`配置 ${c.configurationRevision?`r${c.configurationRevision}`:'随软件内置'}`,c.skills&&`Skills ${c.skillsRevision?`r${c.skillsRevision}`:'随软件内置'}`].filter(Boolean).join(' · '))),
   showCheck&&h('button',{type:'button',style:button,disabled:Boolean(working||statusError)||contentBusy(c),onClick:()=>controller.run('check-updates')},'检查内容更新')),
  h('p',{role:c.state==='error'?'alert':'status',style:{...note,marginTop:8,overflowWrap:'anywhere',...(c.state==='error'?{color:'var(--dsw-alias-state-error-primary, #a82332)'}:{})}},message),
  c.message&&c.state==='current'&&h('p',{style:note},c.message),
  c.state==='downloading'&&h(React.Fragment,null,
   h('div',{role:'progressbar','aria-label':'内容下载进度','aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':progress,style:{height:6,marginTop:10,borderRadius:999,overflow:'hidden',background:border}},h('div',{style:{width:`${progress}%`,height:'100%',background:accent}})),
   h('p',{style:note},`${size(c.downloadedBytes)} / ${size(c.totalBytes)} · ${progress}%`)),
  ['available','ready'].includes(c.state)&&h('div',{style:{display:'flex',justifyContent:'flex-end',marginTop:10}},h('button',{type:'button',disabled:Boolean(working||statusError),style:primary,onClick:()=>controller.run(c.state==='available'?'download-content-update':'restart-content-update')},c.state==='available'?'下载内容更新':'重启使内容生效')),
  c.state==='ready'&&h('p',{style:note},'可以继续使用；重启前请先完成正在运行的任务。'))
}
export function ContentUpdateSettings({controller,style}) {
 const {status,statusError,working}=useUpdates(controller),content=status?.contentUpdate
 if(!content?.enabled)return null
 return h('section',{style},h(ContentPanel,{controller,content,statusError,working,showCheck:!softwareAvailable(status)}))
}

export function UpdatePanel({controller}) {
 const {status,statusError,error,working}=useUpdates(controller),s=status?.update,c=status?.contentUpdate
 const verifyingPackage=s?.state==='verifying',state=verifyingPackage?'verifying':working||s?.state||status?.phase
 const busy=['checking','downloading','verifying','applying','switching','settings'].includes(state)
 const enabled=softwareAvailable(status)
 const softwareEnabled=s?.userEnabled??s?.enabled
 const toggleLocked=Boolean(working||statusError)||s?.busy||s?.installOnQuit||s?.installOnNextStart||['checking','downloading','verifying','ready','applying'].includes(s?.state)
 const optionLocked=toggleLocked||!softwareEnabled||!enabled
 const macInstallNeedsDownload=s?.nativeUpdater&&s.automaticDownload!==true
 const policy=s?.policy||c?.policy||'stable',locked=Boolean(statusError)||busy||state==='ready'||s?.busy||contentBusy(c)
 const channels=[['stable','公测版'],['development','开发版']].filter(([value])=>!s?.policies||s.policies.includes(value))
 const setPolicy=async value=>{
  if(locked||value===policy)return
  const saved=await controller.run(value==='development'?'use-development-updates':'use-stable-updates')
  if(saved&&softwareEnabled)await controller.run('check-updates')
 }
 // A Windows delta checks the installed files it reuses before it is ready.
 const verifying=state==='downloading'&&s?.downloadStage==='verifying'
 const progress=percent(s),determinate=verifying?s.totalFiles>0:state==='downloading'&&s?.downloadStage!=='extracting'&&s?.totalBytes>0
 const message=state==='available'?`发现新版本 ${s.latestVersion}`:verifyingPackage?'正在校验安装包…':verifying?'正在校验本机文件':state==='downloading'?`${s.downloadStage==='extracting'?'正在准备安装':'正在下载'} ${s.latestVersion}`:state==='checking'?'正在检查更新…':state==='switching'?'正在切换更新渠道…':state==='applying'?'正在退出并安装更新…':state==='installed'?'更新已完成':state==='up_to_date'?'当前已是最新版本':null
 const alert=statusError||(!busy&&(error||s?.error))
 return h('div',{'data-eduwork-update-panel':true},
  h('div',{style:row},
   h('div',{style:{minWidth:0}},
    h('div',{style:{fontSize:14}},'软件更新'),
    h('p',{style:{...note,overflowWrap:'anywhere'}},status?.version?`当前版本 ${status.version}`:statusError?'版本暂不可用':'正在读取版本…'),
    s?.canToggle===false&&status.message&&h('p',{style:note},status.message)),
   h('div',{style:{display:'grid',justifyItems:'end',gap:8,flexShrink:0}},
    h('button',{type:'button',style:button,disabled:!statusError&&(locked||!enabled),onClick:statusError?controller.retry:()=>controller.run('check-updates')},statusError?'重试读取状态':state==='checking'?'检查中…':'检查更新'),
    s?.releaseNotesURL&&h('a',{href:s.releaseNotesURL,target:'_blank',rel:'noopener noreferrer',style:button},'查看发行说明'))),
  s?.canToggle&&updateOption({controller,action:'software-updates',label:'启用软件更新',checked:Boolean(softwareEnabled),disabled:toggleLocked,
   description:statusError?'恢复连接后可修改此设置。':working==='settings'?'正在保存设置…':toggleLocked?'更新完成后可修改此设置。':!softwareEnabled?'软件更新已关闭。重新开启后沿用所选渠道和设置。':'允许检查、下载和安装软件更新。'}),
  s?.canToggle&&typeof s.checkOnStartup==='boolean'&&h(React.Fragment,null,
   updateOption({controller,action:'startup-update-check',label:'启动时检查更新',checked:s.checkOnStartup,disabled:optionLocked,
    description:'每次启动应用后检查一次新版。'}),
   updateOption({controller,action:'periodic-update-check',label:'定时检查更新',checked:s.periodicChecks,disabled:optionLocked,
    description:'运行期间每 4 小时检查一次，驻留托盘时也生效。'}),
   updateOption({controller,action:'automatic-download',label:'自动下载更新包',checked:s.automaticDownload,disabled:optionLocked,
    description:'发现新版本后在后台下载。'}),
   updateOption({controller,action:'automatic-install',label:'自动安装更新包',checked:s.automaticInstall,disabled:optionLocked||macInstallNeedsDownload,
    description:s.nativeUpdater?'开启自动下载后，可在正常退出应用时安装。':s.canSchedule===false?'正常退出应用时安装已校验的更新。':'已校验的更新将在下次启动时安装。'})),
  (enabled||s?.canToggle)&&s&&channels.length>0&&h('label',{style:optionRow},
   h('span',null,'更新渠道',h('span',{style:{...note,display:'block'}},policy==='development'?'接收开发版及更新的公测版。':'仅接收公测版。切换渠道不会降级。')),
   h('select',{'aria-label':'更新渠道',value:policy,disabled:locked||channels.length===1,
    style:{...button,minWidth:128,cursor:locked||channels.length===1?'default':'pointer'},onChange:e=>void setPolicy(e.currentTarget.value)},
    ...channels.map(([value,label])=>h('option',{key:value,value},label)))),
  !statusError&&message&&(s?.enabled!==false||state==='switching')&&h('div',{style:{...row,alignItems:'center',marginTop:12}},
   h('span',{role:'status','aria-live':'polite',style:{fontSize:12,color:secondary}},message),
   state==='available'&&s&&h('button',{type:'button',style:primary,onClick:()=>controller.run('download-update')},'下载更新')),
  !statusError&&s?.enabled!==false&&['checking','downloading','verifying','applying'].includes(state)&&h('div',null,
   h('style',null,'@keyframes eduwork-update-progress{from{transform:translateX(-100%)}to{transform:translateX(334%)}}[data-eduwork-update-indeterminate]{animation:eduwork-update-progress 1.4s linear infinite}@media(prefers-reduced-motion:reduce){[data-eduwork-update-indeterminate]{animation:none}}'),
   h('div',{role:'progressbar','aria-label':verifyingPackage?'安装包校验进度':verifying?'本机文件校验进度':state==='downloading'?'更新下载进度':'更新处理进度','aria-valuemin':0,'aria-valuemax':100,...(determinate?{'aria-valuenow':progress}:{}),style:{height:6,marginTop:10,overflow:'hidden',borderRadius:999,background:border}},
    h('div',{'data-eduwork-update-indeterminate':determinate?undefined:true,style:{width:determinate?`${progress}%`:'30%',height:'100%',borderRadius:999,background:accent,transition:determinate?'width .2s ease':undefined}})),
   state==='downloading'&&h('div',{style:{...row,marginTop:6,fontSize:11,color:secondary,fontVariantNumeric:'tabular-nums'}},
    h('span',{style:{minWidth:0,overflowWrap:'anywhere'}},verifying?'增量更新沿用的本机文件':s?.downloadStage==='extracting'?'正在解包并校验':s?.fileName||'正在下载发行包'),
    h('span',{style:{flexShrink:0}},verifying?(determinate?`已检查 ${s.checkedFiles} / ${s.totalFiles} 个 · ${progress}%`:'正在准备…'):determinate?`${size(s.downloadedBytes)} / ${size(s.totalBytes)} · ${progress}%`:s?.downloadStage==='extracting'?'请稍候…':'后台下载中…')),
   state==='downloading'&&h('p',{style:note},'下载期间可以继续对话，关闭此面板不影响下载。')),
  !statusError&&state==='ready'&&h('div',{style:{marginTop:12,padding:11,border:`1px solid ${border}`,borderRadius:10}},
   h('p',{role:'status',style:{margin:0,fontSize:12}},s.installOnQuit?`版本 ${s.latestVersion} 已下载并校验，将在退出应用时安装。`:s.installOnNextStart?`版本 ${s.latestVersion} 已校验，将在下次启动时安装。`:`版本 ${s.latestVersion} 已下载并校验。`),
   h('p',{style:note},'可继续使用当前版本。重启安装前，请先完成正在运行的任务。'),
   h('div',{style:{display:'flex',justifyContent:'flex-end',flexWrap:'wrap',gap:8,marginTop:10}},
    s.canSchedule!==false&&!s.installOnQuit&&!s.installOnNextStart&&h('button',{type:'button',style:button,onClick:()=>controller.run('schedule-update')},'下次启动时安装'),
    h('button',{type:'button',style:primary,onClick:()=>controller.run('install-update')},'立即重启更新'))),
  alert&&h('p',{role:'alert',style:{...note,marginTop:12,color:'var(--dsw-alias-state-error-primary, #a82332)',overflowWrap:'anywhere'}},alert),
  status?.url&&h('a',{href:status.url,target:'_blank',rel:'noopener noreferrer',style:{...button,display:'inline-block',marginTop:12}},'打开下载页面'))
}
export function UpdateFooter({controller,wide=true}) {
 const {status,open,statusError,working}=useUpdates(controller),s=status?.update,c=status?.contentUpdate
 const verifyingPackage=s?.state==='verifying',state=verifyingPackage?'verifying':working||s?.state
 useEffect(()=>{if(!open)return;const key=e=>{if(e.key==='Escape')controller.close()};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[open])
 if((!status&&!statusError)||status?.shell==='web')return null
 // The native Electron shell delegates software reminders to the official
 // sidebar indicator/badge. Wails and plain Web keep the legacy combined entry.
 const officialSoftwareIndicator=typeof window!=='undefined'&&(window as any).dshDesktop?.protocolVersion===1
 const contentVisible=Boolean(c?.enabled&&['available','downloading','ready','requires_software'].includes(c.state))
 const softwareVisible=!officialSoftwareIndicator&&s?.enabled&&['available','downloading','verifying','ready','applying'].includes(state)
 const softwareLabel=statusError?'更新状态不可用':state==='available'?'更新':verifyingPackage?'正在校验…':state==='downloading'?(s?.downloadStage==='verifying'?`校验 ${percent(s)}%`:s?.totalBytes>0?`下载 ${percent(s)}%`:'正在下载…'):state==='ready'?(s.installOnQuit?'退出时更新':'重启更新'):'正在更新…'
 const contentLabel=c?.state==='downloading'?`内容 ${percent(c)}%`:c?.state==='ready'?'内容待生效':'内容更新'
 const label=softwareVisible?softwareLabel:contentLabel
 const contentPrompt=contentVisible&&!softwareVisible
 const visible=wide&&(softwareVisible||contentVisible)
 return h(React.Fragment,null,
  visible&&h('button',{type:'button','aria-label':contentPrompt?'查看内容更新':'查看更新',title:contentPrompt?'查看配置与 Skills 更新':'查看软件及内容更新',onClick:controller.open,'data-eduwork-update-entry':true,'data-chatecnu-update-prompt':softwareVisible?state:c.state,style:{flex:'0 0 auto',alignSelf:'center',minWidth:42,height:28,margin:'4px 2px 4px 6px',border:0,borderRadius:999,padding:'0 11px',background:'var(--dsw-alias-state-info-primary, #4f78dd)',color:'white',cursor:'pointer',fontSize:11,fontWeight:700,whiteSpace:'nowrap',fontFamily:'system-ui, sans-serif'}},label),
  open&&createPortal(h('div',{style:{position:'fixed',inset:0,zIndex:11000,display:'grid',placeItems:'center',background:'rgba(0,0,0,.28)',backdropFilter:'blur(3px)'},onMouseDown:e=>{if(e.target===e.currentTarget)controller.close()}},
   h('section',{role:'dialog','aria-modal':true,'aria-label':'更新',style:{boxSizing:'border-box',width:'min(480px, calc(100vw - 32px))',maxHeight:'calc(100vh - 48px)',overflowY:'auto',padding:24,border:`1px solid ${border}`,borderRadius:16,background:'var(--dsw-alias-bg-layer-1, #fff)',color:'var(--dsw-alias-label-primary, #222)',boxShadow:'0 20px 70px #0003'}},
    h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}},h('h2',{style:{fontSize:20,margin:0}},'更新'),h('button',{type:'button','aria-label':'关闭更新面板',disabled:verifyingPackage&&!statusError,onClick:controller.close,style:button},'×')),
    h(UpdatePanel,{controller}),
    h(ContentUpdateSettings,{controller,style:{marginTop:16,paddingTop:16,borderTop:`1px solid ${border}`}}))),document.body))
}

