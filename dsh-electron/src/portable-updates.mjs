import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

export function portableUpdateEdition({configuration={},version,prior=null,distribution='eduwork'}) {
 let edition={schemaVersion:1,enabled:false,manifestBaseURL:'',defaultPolicy:'stable',target:'windows-amd64',flavor:'offline',allowShellMigration:true,distribution}
 if(configuration.provider && !['github','static','disabled'].includes(configuration.provider))throw Error('不支持的更新源类型')
 if(configuration.provider==='disabled'){
  edition.enabled=false
 }else if(configuration.manifestURL){
  const url=new URL(configuration.manifestURL),match=/^(.*)\/([^/]+)\/latest-(windows-(?:amd64|x64))\.json$/.exec(url.pathname)
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!match)throw Error('Windows 更新地址必须是 HTTPS 的渠道清单地址')
  edition={...edition,provider:'static',enabled:true,manifestBaseURL:url.origin+match[1],defaultPolicy:match[2],target:match[3]}
 }else if(configuration.provider==='github'){
  if(!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(configuration.repository??''))throw Error('GitHub 更新源需要 owner/repo')
  edition={...edition,enabled:true,provider:'github',repository:configuration.repository}
 }else if(configuration.provider==='static'){
  throw Error('静态更新源需要 manifestURL')
 }else{
  if(prior?.schemaVersion===1)edition={...edition,...prior}
 }
 edition.distribution=distribution
 // A feed URL selects the server, not the user's release preference.
 edition.defaultPolicy=configuration.defaultPolicy??(/-dev\./.test(version)?'development':'stable')
 if(!['stable','development'].includes(edition.defaultPolicy))throw Error('更新默认渠道必须为 stable 或 development')
 return edition
}

export function resolveUpdateConfiguration(defaults={},updates={},prior=null) {
 const explicit=updates.provider || updates.manifestURL || updates.repository
 const inherited=prior?.schemaVersion===1 && prior.enabled!==false && (prior.manifestBaseURL || prior.provider==='github')
 // Old Go bridge feeds are user installation state. A new package's GitHub
 // default must not silently change their institution or release route.
 const result={...(inherited&&!explicit?{defaultPolicy:defaults.defaultPolicy}:defaults),...updates}
 if(updates.provider==='github'){delete result.manifestURL}
 if(updates.manifestURL && updates.provider!=='disabled'){result.provider='static';delete result.repository}
 return result
}

export async function startPortableUpdates({root,updates={},defaults={},version,distribution,onQuit,platform=process.platform}) {
 if(platform!=='win32')return null
 const state=join(root,'data/state/updates')
 const prior=await readFile(join(root,'config/update.bridge.json'),'utf8').then(JSON.parse).catch(()=>null)
 const configuration=resolveUpdateConfiguration(defaults,updates,prior)
 const edition=portableUpdateEdition({configuration,version,prior,distribution})
 await mkdir(state,{recursive:true});const path=join(state,'electron-edition.json');await writeFile(path,JSON.stringify(edition))
 const child=spawn(join(root,'resources/update/EduWork-Updater.exe'),['serve','--root',root,'--edition',path,'--parent-pid',String(process.pid)],{windowsHide:true,stdio:['pipe','pipe','pipe']})
 let sequence=0,exited=false,closing=false,lastError='';const pending=new Map()
 child.stderr.on('data',chunk=>{lastError=(lastError+chunk).slice(-4096)})
 const done=new Promise(resolve=>{
  const finish=()=>{exited=true;for(const value of pending.values())value.reject(Error(lastError||'更新服务已退出'));pending.clear();resolve(null)}
  child.once('exit',finish)
  child.once('error',error=>{lastError=error.message;finish()})
 })
 const lines=createInterface({input:child.stdout});lines.on('line',line=>{
  let reply;try{reply=JSON.parse(line)}catch{return}
  if(reply.event==='quit-for-update'){onQuit();return}
  const request=pending.get(reply.id);if(!request)return;pending.delete(reply.id)
  if(reply.error)request.reject(Error(reply.error));else request.resolve(reply.status)
 })
 const call=action=>new Promise((resolve,reject)=>{if(exited||closing){reject(Error(lastError||'更新服务已退出'));return};const id=++sequence;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,action})+'\n',error=>{if(error){pending.delete(id);reject(error)}})})
 const format=s=>({shell:'electron',version,phase:s.state,message:s.enabled?'自动检查更新；下载后可立即重启或下次启动安装。':'当前未配置更新渠道，请检查 config/eduwork.jsonc 的 updates。',update:s})
 try {await call('apply-scheduled');await call('check-updates')}
 catch(error){child.stdin.end();await done;lines.close();throw error}
 return {action:async action=>format(await call(action)),async close(){closing=true;child.stdin.end();await done;lines.close()}}
}
