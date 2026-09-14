import React,{useLayoutEffect,useSyncExternalStore} from 'react'

/** One toggle shared by the public header slot, blank-page fallback and reader. */
export function StudioEntry({surface,target,placement='utilities'}:any) {
  const state:any=useSyncExternalStore(surface.subscribe,surface.getSnapshot,surface.getSnapshot)
  const active=state.open&&state.sessionId===target.sessionId
  return <>
    <style>{`
      .ks-studio-entry{box-sizing:border-box;display:inline-flex;flex:none;align-items:center;justify-content:center;gap:6px;height:32px;min-width:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l3,#ded7cf);border-radius:8px;background:var(--dsw-alias-bg-base,#fffdf9);color:var(--dsw-alias-label-primary,#514337);font:inherit;font-size:12px;line-height:1;cursor:pointer;white-space:nowrap;pointer-events:auto}
      .ks-studio-entry:hover{background:var(--dsw-alias-interactive-bg-hover,#f4eee5)}
      .ks-studio-entry[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-active,#eee4d5);border-color:var(--dsw-alias-label-tertiary,#9b876e)}
      .ks-studio-entry:focus-visible{outline:2px solid currentColor;outline-offset:2px}
      @media(max-width:780px){.ks-studio-entry{width:32px;padding:0}.ks-studio-entry-label{display:none}}
    `}</style>
    <button className="ks-studio-entry" type="button" data-knowledge-studio-entry="true" data-studio-entry-placement={placement}
      aria-label="Studio 工作区" aria-pressed={active} title={active?'关闭 Studio 工作区':'打开 Studio 工作区'}
      onClick={()=>surface.toggle(target)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M6.5 8h5M6.5 12h5M6.5 16h3"/></svg>
      <span className="ks-studio-entry-label">Studio</span>
    </button>
  </>
}

export function StudioHeaderEntry({surface,sessions,useSession,sessionId:providedSessionId}:any) {
  const sessionId=providedSessionId??useSession((state:any)=>state.sessionId)
  const list:any=useSyncExternalStore(sessions.list.subscribe,sessions.list.getSnapshot,sessions.list.getSnapshot)
  const state:any=useSyncExternalStore(surface.subscribe,surface.getSnapshot,surface.getSnapshot)
  const current=sessionId===list.current,cwd=list.byId[sessionId]?.cwd
  // The host renders this slot only while its header is visible. Track that
  // lifetime rather than guessing from a potentially lagging blank summary.
  useLayoutEffect(()=>{
    if(!current||!cwd)return
    surface.setHeaderSession(sessionId)
    return ()=>surface.clearHeaderSession(sessionId)
  },[surface,sessionId,current,cwd])
  if(!current||!cwd||state.reading)return null
  return <StudioEntry surface={surface} target={{sessionId,cwd}}/>
}

export function StudioBlankEntry({surface,sessions}:any) {
  const list:any=useSyncExternalStore(sessions.list.subscribe,sessions.list.getSnapshot,sessions.list.getSnapshot)
  const state:any=useSyncExternalStore(surface.subscribe,surface.getSnapshot,surface.getSnapshot)
  const sessionId=list.current,cwd=list.byId[sessionId]?.cwd
  if(!sessionId||!cwd||state.reading||state.headerSessionId===sessionId)return null
  return <div style={{position:'absolute',right:28,top:12,pointerEvents:'none'}}>
    <StudioEntry surface={surface} target={{sessionId,cwd}} placement="blank"/>
  </div>
}
