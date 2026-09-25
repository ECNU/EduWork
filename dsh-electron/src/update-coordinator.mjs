// A shared surface; software and signed content retain separate transactions.
export function updateCoordinator({software,content,version,onRestart,onPolicy,beforeInstall=async()=>true}) {
  const jobs=new Set()
  let restarting=false
  const background=promise=>{jobs.add(promise);promise.catch(()=>{}).finally(()=>jobs.delete(promise))}
  const snapshot=async()=>{
    const status=software?await software.action('status'):{shell:'electron',version,phase:'disabled',message:'未配置软件更新',update:{enabled:false,state:'disabled'}}
    return {...status,contentUpdate:content.snapshot()}
  }
  return {
    async action(action) {
      if(action==='status')return snapshot()
      if(action==='check-updates'||action==='check-updates-background') {
        if(software)await software.action(action==='check-updates-background' && !(await software.action('status')).update?.nativeUI ? 'check-updates' : action)
        background(content.check({retryFailed:action==='check-updates'}));return snapshot()
      }
      if(action==='download-content-update') {background(content.download());return snapshot()}
      if(action==='restart-content-update') {
        if(content.snapshot().state!=='ready')throw Error('尚无待生效的内容更新')
        if(!restarting){
          restarting=true
          setImmediate(()=>{Promise.resolve(onRestart()).finally(()=>{restarting=false}).catch(()=>{})})
        }
        return snapshot()
      }
      if(action==='use-stable-updates'||action==='use-development-updates') {
        if(content.busy||content.state.pending)throw Error('请先完成当前内容更新再切换渠道')
        const policy=action==='use-development-updates'?'development':'stable'
        const result=software?await software.action(action):null
        if(result?.update?.policy&&result.update.policy!==policy)throw Error(result.update.error||'软件更新渠道未能切换')
        if(!software)await onPolicy?.(policy)
        await content.selectPolicy(policy)
        return result?{...result,contentUpdate:content.snapshot()}:snapshot()
      }
      if(action==='download-update'&&content.snapshot().state==='available')background(content.download())
      if(!software)throw Error('未配置软件更新')
      if(action==='install-update'&&!await beforeInstall())return snapshot()
      const result=await software.action(action);return {...result,contentUpdate:content.snapshot()}
    },
    async close() {await content.close();await Promise.allSettled([...jobs]);await software?.close()},
  }
}
