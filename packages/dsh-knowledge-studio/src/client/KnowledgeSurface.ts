export type Target = { sessionId: string; cwd: string }
type SurfaceSnapshot = { open: boolean; sessionId: string; reading?: boolean; readingTarget?: HTMLElement | null; headerSessionId?: string; detailsCollapsed?: boolean }
export type SessionMemory = {
  view?: string
  mindmaps?: Record<string,any>
  expanded?: boolean
  scrollPositions?: Record<string,number>
  evidence?: any
  artifactId?: string
  awaitingArtifactSince?: string
}

export class KnowledgeSurface {
  private snapshot: SurfaceSnapshot = Object.freeze({
    open: false,
    sessionId: '',
  })
  private listeners = new Set<() => void>()
  private activation: { activate(): void; deactivate(): void } | undefined
  private memory = new Map<string, SessionMemory>()
  private preferredOpen = false
  private preferenceEdited = false
  private automaticOpen = false
  private target: Target | null = null
  constructor(private layout: any, private canUseDetails: (sessionId:string)=>boolean = ()=>true, private savePreference: (open:boolean)=>void = ()=>{}, private canRestoreDetails: (sessionId:string)=>boolean = canUseDetails) {}
  restorePreference = (open:boolean) => {
    if(this.preferenceEdited)return
    this.preferredOpen=open
    this.restoreSidebar()
  }
  private choose = (open:boolean) => {
    this.preferenceEdited=true
    this.preferredOpen=open
    this.savePreference(open)
  }
  supportsDetails = (sessionId: string) => this.canUseDetails(sessionId)
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  getSnapshot = () => this.snapshot
  setHeaderSession = (sessionId:string) => {
    if(this.snapshot.headerSessionId===sessionId)return
    this.snapshot=Object.freeze({...this.snapshot,headerSessionId:sessionId})
    this.listeners.forEach(listener=>listener())
  }
  clearHeaderSession = (sessionId:string) => {
    if(this.snapshot.headerSessionId===sessionId)this.setHeaderSession('')
  }
  setDetailsCollapsed = (detailsCollapsed:boolean) => {
    if(this.snapshot.detailsCollapsed!==detailsCollapsed) {
      this.snapshot=Object.freeze({...this.snapshot,detailsCollapsed})
      this.listeners.forEach(listener=>listener())
    }
    if(detailsCollapsed&&this.snapshot.open&&!this.snapshot.reading) {
      if(this.automaticOpen) {
        // A restored preference must never replace the conversation with a
        // reader when the host cannot provide a visible details column.
        const target=this.target
        this.close()
        this.target=target
      } else this.setReading(true)
    }
  }
  setReading = (reading: boolean) => {
    // Older hosts give blank sessions a zero-width details column.
    if (!reading && this.snapshot.open && (!this.canUseDetails(this.snapshot.sessionId)||this.snapshot.detailsCollapsed)) {
      this.dismiss(); return
    }
    if(reading)this.automaticOpen=false
    this.snapshot = Object.freeze({...this.snapshot,reading})
    this.listeners.forEach(listener=>listener())
  }
  setReadingTarget = (readingTarget: HTMLElement | null) => {
    if(this.snapshot.readingTarget===readingTarget)return
    this.snapshot = Object.freeze({...this.snapshot,readingTarget})
    this.listeners.forEach(listener=>listener())
  }
  bind = (activation: { activate(): void; deactivate(): void } | undefined) => {
    this.activation = activation
    if (activation && this.snapshot.open) activation.activate()
  }
  currentTarget = () => this.target
  adoptTab = (target:Target, visible:boolean) => {
    if(!visible&&this.snapshot.sessionId!==target.sessionId)return
    this.target=target
    this.snapshot=Object.freeze({...this.snapshot,open:visible,sessionId:target.sessionId,reading:visible&&this.snapshot.sessionId===target.sessionId?this.snapshot.reading:false})
    this.listeners.forEach(listener=>listener())
  }
  tabClosed = (sessionId:string) => {
    if(this.snapshot.sessionId!==sessionId)return
    this.automaticOpen=false
    this.snapshot=Object.freeze({...this.snapshot,open:false,sessionId:'',reading:false})
    this.listeners.forEach(listener=>listener())
  }
  sessionState = (sessionId: string): SessionMemory => {
    const state=this.memory.get(sessionId)
    if(!state)return {}
    // Retired workspace views cannot reopen a reader or a stale source pane.
    if(state.view&&state.view!=='home') {
      const migrated={view:'home',mindmaps:state.mindmaps,awaitingArtifactSince:state.awaitingArtifactSince}
      this.memory.set(sessionId,migrated)
      return migrated
    }
    return state
  }
  remember = (sessionId: string, patch: SessionMemory) =>
    this.memory.set(sessionId, { ...this.sessionState(sessionId), ...patch })
  private show = (target: Target, automatic=false) => {
    this.target = target
    this.automaticOpen=automatic
    const reading=!automatic&&(!this.canUseDetails(target.sessionId)||(this.snapshot.open&&this.snapshot.sessionId===target.sessionId&&this.snapshot.reading))
    this.snapshot = Object.freeze({ ...this.snapshot, open: true, sessionId: target.sessionId, reading:Boolean(reading) })
    this.activation?.activate()
    this.layout.openDetails()
    this.listeners.forEach((listener) => listener())
  }
  open = (target: Target) => {
    this.show(target)
  }
  enter = (target: Target) => {
    this.target=target
    if(this.snapshot.open&&this.snapshot.sessionId!==target.sessionId) {
      this.close()
      this.target=target
    }
    this.restoreSidebar()
  }
  restoreSidebar = () => {
    if(this.snapshot.open||!this.preferredOpen||!this.target||!this.canRestoreDetails(this.target.sessionId))return
    this.show(this.target,true)
  }
  close = () => {
    this.automaticOpen=false
    this.layout.closeDetails()
    this.activation?.deactivate()
    this.target=null
    this.snapshot = Object.freeze({ ...this.snapshot, open: false, sessionId: '', reading:false })
    this.listeners.forEach((listener) => listener())
  }
  dismiss = (target: Target | null = this.target) => {
    this.choose(false)
    this.close()
  }
  toggle = (target: Target) => {
    if(this.snapshot.open && this.snapshot.sessionId === target.sessionId)this.dismiss(target)
    else {this.choose(true);this.open(target)}
  }
}
