import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {writeAtomicJSON} from './atomic-json.js'
import { dirname, join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { citationSnapshot, generateText } from './generation.js'
import { basicEvidence, verifyBasicCitation } from './basic-evidence.js'
import { CONTENT_SCHEMAS, contentItems, validateContent } from './studio-content.js'
import {readCreationGuidance} from '@eduwork/dsh-artifact-services/creation-guidance'
import {renderOfficePreview} from '@eduwork/dsh-artifact-services/office-preview'
import { exportDocument, readExportFile } from './studio-export.js'
import { exportWithOfficeTools } from './office-tools.js'
import { renderMedia } from './studio-media.js'
import { videoPoster } from './video-poster.js'
import { normalizeMediaOptions } from './media-providers.js'
import {studioInstructions} from './studio-instructions.js'
import {mindmapTree} from './mindmap.js'
import {createEvidenceBundle} from './evidence-labels.js'
import {canRetryOfficeExport,officeFormatFor,isLegacyOfficeExportFailure} from './export-recovery.js'
import {executionTurn,presentArtifact,sameArtifactTarget,attemptSnapshot,settleArtifact} from './artifact-lifecycle.js'

const VERSION = 1
const SUPPORTED_KINDS = new Set(['quiz', 'flashcards', ...Object.keys(CONTENT_SCHEMAS)])

function clone(value) { return structuredClone(value) }
function now() { return new Date().toISOString() }
function artifactExportDirectory(root,artifact) {
  return join(root,artifact.id,...(Number.isInteger(artifact.version)&&artifact.version>1?['attempt-'+artifact.version]:[]))
}
const stableJSON=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item)
const officeContentHash=artifact=>createHash('sha256').update(stableJSON({kind:artifact.kind,content:artifact.content,citations:artifact.citations})).digest('hex')
function validateSavedOfficeContent(artifact) {
  if(!officeFormatFor(artifact.kind)||!artifact.content||!Array.isArray(artifact.citations))throw new Error('没有可恢复的已校验 Office 正文')
  const ids=artifact.citations.map(citation=>citation.evidenceId)
  if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length||artifact.citations.some(citation=>typeof citation.path!=='string'||!citation.path))throw new Error('保存的来源快照不完整，不能重试导出')
  const checked=validateContent(artifact.kind,JSON.stringify(artifact.content),artifact.citations)
  if(stableJSON(checked)!==stableJSON(artifact.content))throw new Error('保存的正文未通过完整校验，不能重试导出')
  return officeContentHash(artifact)
}
const deniedExport=error=>/未获批准|权限|拒绝|permission|denied|approval|not authorized/i.test(String(error?.message||error))
function safeMessage(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
    .slice(0, 800)
}

function parseJSON(text) {
  const source = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const starts = ['{', '['].map(character => source.indexOf(character)).filter(index => index >= 0)
  if (!starts.length) throw new Error('The model did not return JSON')
  return JSON.parse(source.slice(Math.min(...starts)))
}

function emptyState() { return { version: VERSION, artifacts: [] } }
function normalizeState(value) {
  return { version: VERSION, artifacts: Array.isArray(value?.artifacts) ? value.artifacts : [] }
}

function summary(artifact) {
  const { content: _content, citations: _citations, interaction: _interaction, attempts, ...value } = artifact
  return {...value,...(attempts?{attempts:attempts.map(({version,title,status,message,callId,finishedAt})=>({version,title,status,message,callId,finishedAt}))}:{})}
}

export class ArtifactStore {
  #path
  #state = null
  #loading = null
  #tail = Promise.resolve()
  #writer

  constructor(path = dshHomePath('plugins', 'dsh-knowledge-studio', 'artifacts.json'), {writeState=writeAtomicJSON}={}) {
    this.#path = path
    this.#writer = writeState
  }

  async #write(state) {
    await this.#writer(this.#path,state)
  }

  async #load() {
    if (this.#state) return this.#state
    if (!this.#loading) this.#loading = this.#readState().catch(error => { this.#loading = null; throw error })
    return this.#loading
  }

  async #readState() {
    let state
    try { state = normalizeState(JSON.parse(await readFile(this.#path, 'utf8'))) }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error
      state = emptyState()
    }
    let changed = false
    for (let index=0;index<state.artifacts.length;index++) {
      const artifact=state.artifacts[index]
      if (['queued', 'running'].includes(artifact.status)) {
        artifact.status = 'interrupted'
        artifact.phase = 'done'
        artifact.message = canRetryOfficeExport(artifact)?'上次进程在导出完成前退出，已保存正文，可重试导出。':'上次进程在生成完成前退出，请重新生成。'
        artifact.updatedAt = now()
        changed=true
      }
      if(artifact.lifecycle?.state==='open') {
        state.artifacts[index]=settleArtifact(artifact,{kind:'interrupted'})
        changed=true
      }
    }
    if (changed) await this.#write(state)
    this.#state=state
    return this.#state
  }

  #mutate(operation, recoverTerminal=false) {
    const task = this.#tail.then(async () => {
      const state = clone(await this.#load())
      for(const artifact of state.artifacts)if(artifact.persistenceError) {
        delete artifact.persistenceError
        artifact.message='上次保存失败，任务已停止；失败记录现已恢复。'
      }
      const result = await operation(state)
      try {await this.#write(state)}
      catch(error) {
        if(!recoverTerminal)throw error
        // An executing task has ended but storage is still unavailable. Expose
        // an explicit unsaved terminal result, never an ownerless running task.
        result.persistenceError=safeMessage(error)
        result.message=`成果记录保存失败，任务已停止；当前失败状态尚未落盘。${safeMessage(error)}`
      }
      this.#state=state
      return clone(result)
    })
    this.#tail = task.catch(() => {})
    return task
  }

  create(workspace, kind, parameters, sessionId = null, lifecycle = null, retryArtifactId = null) {
    if (!SUPPORTED_KINDS.has(kind)) throw new Error(`Unsupported interactive artifact: ${kind}`)
    return this.#mutate(state => {
      const timestamp = now()
      const candidates=lifecycle?state.artifacts.filter(item=>!item.deletedAt&&item.workspaceId===String(workspace.id)&&item.sessionId===sessionId&&item.lifecycle?.state==='open'&&item.lifecycle.turn===lifecycle.turn):[]
      let previous
      if(retryArtifactId) {
        previous=candidates.find(item=>item.id===retryArtifactId)
        if(!previous||previous.kind!==kind||!['failed','cancelled','completed'].includes(previous.status))throw new Error('retryArtifactId must identify a finished attempt of the same kind in this turn; wait for any running attempt first')
      } else if(lifecycle?.targetKey) {
        previous=candidates.find(item=>item.lifecycle.targetKey===lifecycle.targetKey)
        if(previous&&(previous.kind!==kind||!['failed','cancelled','completed'].includes(previous.status)))throw new Error('This target has a different kind or is still running; wait for it before revising the same deliverable')
      } else {
        // Focus/title change during revisions; explicit keys preserve separate deliverables.
        const matching=candidates.filter(item=>!item.lifecycle.targetKey&&sameArtifactTarget(item,kind,parameters))
        if(matching.length===1&&['failed','cancelled','completed'].includes(matching[0].status))previous=matching[0]
      }
      const artifact = {
        id: previous?.id || `artifact_${randomUUID().replaceAll('-', '')}`, kind, workspaceId: String(workspace.id), workspaceTitle: workspace.title,
        sessionId,
        title: `${workspace.title} · ${{quiz:'测验',flashcards:'闪卡',report:'报告',mindmap:'思维导图',table:'数据表',slides:'演示文稿',audio:'音频概览',video:'视频概览'}[kind]}`, parameters,
        status: 'running', phase: 'retrieve', processed: 0, total: null, message: '',
        content: null, citations: [], interaction: {}, version: previous ? previous.version+1 : 1, createdAt: previous?.createdAt || timestamp, updatedAt: timestamp,
        ...(lifecycle?{lifecycle:{...lifecycle,targetKey:previous?.lifecycle.targetKey||lifecycle.targetKey||null,state:'open'},attempts:previous?[...(previous.attempts||[]),attemptSnapshot(previous)]:[]}:{}),
      }
      if(previous)state.artifacts[state.artifacts.indexOf(previous)]=artifact
      else state.artifacts.push(artifact)
      return artifact
    })
  }

  update(artifactId, patch) {
    return this.#mutate(state => {
      const artifact = state.artifacts.find(item => item.id === artifactId)
      if (!artifact) throw new Error(`Unknown Studio artifact: ${artifactId}`)
      Object.assign(artifact, patch, { id: artifact.id, workspaceId: artifact.workspaceId, updatedAt: now() })
      return artifact
    })
  }

  failAttempt(artifactId,patch) {
    return this.#mutate(state=>{
      const artifact=state.artifacts.find(item=>item.id===artifactId)
      if(!artifact)throw new Error(`Unknown Studio artifact: ${artifactId}`)
      Object.assign(artifact,patch,{status:patch.status==='cancelled'?'cancelled':'failed',phase:'done',updatedAt:now()})
      return artifact
    },true)
  }

  settleTurn(sessionId, turn, reason) {
    return this.#mutate(state=>{
      const settled=[]
      for(let index=0;index<state.artifacts.length;index++) {
        const artifact=state.artifacts[index]
        if(artifact.sessionId!==String(sessionId)||artifact.lifecycle?.turn!==turn||artifact.lifecycle.state!=='open')continue
        state.artifacts[index]=settleArtifact(artifact,reason)
        settled.push(artifact.id)
      }
      return settled
    })
  }

  async read(artifactId) {
    const state = await this.#load()
    const artifact = state.artifacts.find(item => item.id === artifactId)
    if (!artifact) throw new Error(`Unknown Studio artifact: ${artifactId}`)
    return clone(artifact)
  }

  async list(workspaceId) {
    const state = await this.#load()
    return state.artifacts.filter(item => !item.deletedAt && item.workspaceId === String(workspaceId)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 100).map(item => clone(summary(presentArtifact(item))))
  }

  interaction(artifactId, action, itemId, value) {
    return this.#mutate(state => {
      const artifact = state.artifacts.find(item => item.id === artifactId)
      if (!artifact) throw new Error(`Unknown Studio artifact: ${artifactId}`)
      if (artifact.status !== 'completed') throw new Error('Artifact generation is not complete')
      const length = artifact.kind === 'quiz' ? artifact.content?.questions?.length : artifact.content?.cards?.length
      const interaction = artifact.interaction && typeof artifact.interaction === 'object' ? artifact.interaction : {}
      if (action === 'reset') {
        artifact.interaction = artifact.kind === 'quiz' ? { current: 0, answers: {}, revealed: {} } : { current: 0, flipped: false, grades: {} }
      } else if (action === 'current') {
        artifact.interaction = { ...interaction, current: Math.max(0, Math.min(Math.max(0, Number(length) - 1), Number(value) || 0)), ...(artifact.kind === 'flashcards' ? { flipped: false } : {}) }
      } else if (artifact.kind === 'quiz' && action === 'answer') {
        artifact.interaction = { ...interaction, answers: { ...(interaction.answers ?? {}), [itemId]: Math.max(0, Number(value) || 0) } }
      } else if (artifact.kind === 'quiz' && action === 'reveal') {
        if (interaction.answers?.[itemId] == null) throw new Error('Choose an answer first')
        artifact.interaction = { ...interaction, revealed: { ...(interaction.revealed ?? {}), [itemId]: true } }
      } else if (artifact.kind === 'flashcards' && action === 'flip') {
        artifact.interaction = { ...interaction, flipped: Boolean(value) }
      } else if (artifact.kind === 'flashcards' && action === 'grade') {
        artifact.interaction = { ...interaction, flipped: false, grades: { ...(interaction.grades ?? {}), [itemId]: value === true } }
      } else throw new Error(`Unsupported artifact interaction: ${action}`)
      artifact.updatedAt = now()
      return artifact
    })
  }
}

function normalizeParameters(kind, value = {}) {
  const focus = String(value.focus ?? '').trim().slice(0, 500)
  const pathPrefix = String(value.pathPrefix ?? '').replaceAll('\\','/').replace(/^\.\//,'').replace(/\/$/,'')
  if (pathPrefix.startsWith('/') || /^[A-Za-z]:/.test(pathPrefix) || pathPrefix.split('/').includes('..')) throw new Error('资料范围必须是工作区内的相对路径')
  const shared = { focus, language:String(value.language || 'zh-CN').slice(0,50), audience:String(value.audience || '').slice(0,200), ...(pathPrefix ? {pathPrefix} : {}), ...(['audio','video'].includes(kind)?normalizeMediaOptions(value):{}) }
  const contentCount=Math.max(2,Math.min(20,Number(value.count)||6))
  if(kind==='mindmap')return {...shared,detail:['overview','detailed'].includes(value.detail)?value.detail:'auto'}
  if(kind==='report')return {...shared,template:['faq','study-guide','custom'].includes(value.template)?value.template:'briefing'}
  if(kind==='table')return {...shared,columns:String(value.columns||'').slice(0,500)}
  if(kind==='slides') {
    const theme=value.theme||'modern-clean'
    if(!['modern-clean','academic-editorial','digital-tech','warm-education'].includes(theme))throw new Error('不支持的演示主题')
    const count=Number(value.count)||6
    if(!Number.isInteger(count)||count<1||count>40)throw new Error('演示文稿页数需为 1～40')
    return {...shared,count,theme,delivery:value.delivery==='reading'?'reading':'presentation'}
  }
  if(kind==='audio')return {...shared,style:['dialogue','critique','debate'].includes(value.style)?value.style:'narration'}
  if(kind==='video')return {...shared,count:contentCount}
  if (kind === 'quiz') {
    const count = [5, 8, 12].includes(Number(value.count)) ? Number(value.count) : 8
    const difficulty = ['easy', 'medium', 'hard'].includes(value.difficulty) ? value.difficulty : 'medium'
    return { count, difficulty, ...shared }
  }
  const count = [8, 15, 24].includes(Number(value.count)) ? Number(value.count) : 15
  return { count, difficulty:['easy','medium','hard'].includes(value.difficulty)?value.difficulty:'medium', ...shared }
}

function validateQuiz(text, evidence, requested) {
  const parsed = parseJSON(text)
  const allowed = new Set(evidence.map(item => item.evidenceId))
  const questions = []
  for (const item of Array.isArray(parsed.questions) ? parsed.questions : []) {
    const options = Array.isArray(item?.options) ? item.options.map(option => typeof option==='string'?option.trim():'') : []
    const correctIndex = item?.correctIndex
    const evidenceIds = [...new Set(Array.isArray(item?.evidenceIds) ? item.evidenceIds.filter(id => allowed.has(id)) : [])]
    if (!String(item?.question ?? '').trim() || options.length < 2 || options.some(option=>!option) || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) continue
    questions.push({ id: `q${questions.length + 1}`, question: String(item.question).trim().slice(0, 800), options, correctIndex, explanation: String(item.explanation ?? '').trim().slice(0, 1200), evidenceIds })
    if (questions.length >= requested) break
  }
  if (!questions.length) throw new Error('模型未返回可作答的有效题目')
  return { title: String(parsed.title ?? '工作区测验').trim().slice(0, 120) || '工作区测验', questions }
}

function validateFlashcards(text, evidence, requested) {
  const parsed = parseJSON(text)
  const allowed = new Set(evidence.map(item => item.evidenceId))
  const cards = []
  for (const item of Array.isArray(parsed.cards) ? parsed.cards : []) {
    const evidenceIds = [...new Set(Array.isArray(item?.evidenceIds) ? item.evidenceIds.filter(id => allowed.has(id)) : [])]
    if (!String(item?.front ?? '').trim() || !String(item?.back ?? '').trim()) continue
    cards.push({ id: `card${cards.length + 1}`, front: String(item.front).trim().slice(0, 700), back: String(item.back).trim().slice(0, 1400), evidenceIds })
    if (cards.length >= requested) break
  }
  if (!cards.length) throw new Error('模型未返回具有正反面内容的有效闪卡')
  return { title: String(parsed.title ?? '工作区抽认卡').trim().slice(0, 120) || '工作区抽认卡', cards }
}

export class ArtifactEngine {
  #ctx
  #manager
  #store
  #outputRoot
  #tasks = new Map()
  #mediaProviders
  #settlements = new Set()

  constructor(ctx, manager, { artifactPath, mediaProviders, writeArtifactState } = {}) {
    this.#ctx = ctx
    this.#manager = manager
    this.#mediaProviders = mediaProviders
    this.#store = new ArtifactStore(artifactPath,{writeState:writeArtifactState})
    this.#outputRoot = join(artifactPath ? dirname(artifactPath) : dshHomePath('plugins','dsh-knowledge-studio'), 'exports')
    ctx.on?.('session/event',(session,event)=>{
      if(event.type!=='turn/end')return
      const settlement=this.settleTurn(session.id,event.data.turn,event.data.reason)
      this.#settlements.add(settlement)
      void settlement.catch(error=>ctx.logger?.warn?.('Studio turn settlement failed',error)).finally(()=>this.#settlements.delete(settlement))
    })
  }

  async settleTurn(sessionId,turn,reason) {
    await Promise.allSettled([...this.#tasks.values()].filter(task=>task.sessionId===String(sessionId)&&task.turn===turn).map(task=>task.promise))
    return this.#store.settleTurn(sessionId,turn,reason)
  }

  list(workspaceId) { return this.#store.list(workspaceId) }
  async read(artifactId, {attempt = false} = {}) {
    const stored = await this.#store.read(artifactId)
    const artifact = attempt ? stored : presentArtifact(stored)
    const workspace = this.#ctx.workspaceRegistry.get(artifact.workspaceId)
    if (!workspace || !artifact.citations?.length) return artifact
    const citations = []
    for (const citation of artifact.citations) {
      if (citation.evidenceId.startsWith('file_')) {
        citations.push({ ...citation, fresh: await verifyBasicCitation(this.#ctx.fs, workspace, citation) })
        continue
      }
      const current = await this.#manager.readEvidence(workspace, citation.evidenceId)
      citations.push({ ...citation, fresh: Boolean(current && current.revisionHash === citation.revisionHash && current.excerptHash === citation.excerptHash) })
    }
    return { ...artifact, citations }
  }
  interaction(artifactId, action, itemId, value) { return this.#store.interaction(artifactId, action, itemId, value) }
  async manage(artifactId, action, value, sessionId) {
    if(action==='retry-export')return this.#retryOfficeExport(artifactId)
    const artifact = await this.#store.read(artifactId)
    if (action === 'cancel') { this.#tasks.get(artifactId)?.controller.abort(new Error('用户取消生成')); return this.wait(artifactId) }
    if (action === 'rename') {
      const title=String(value||'').trim().slice(0,150); if(!title)throw new Error('名称不能为空')
      return this.#store.update(artifactId,{title})
    }
    if (action === 'delete') {
      this.#tasks.get(artifactId)?.controller.abort(new Error('用户移除成果'))
      await this.wait(artifactId)
      return this.#store.update(artifactId,{deletedAt:now()})
    }
    if (action === 'retry') {
      if(this.#tasks.has(artifactId))throw new Error('成果仍在生成')
      const workspace=this.#ctx.workspaceRegistry.get(artifact.workspaceId)
      if(!workspace)throw new Error('原工作区不可用')
      return this.start(workspace,artifact.kind,artifact.parameters,sessionId || artifact.sessionId)
    }
    throw new Error('未知成果操作')
  }
  async export(artifactId,format) {
    const artifact=await this.#store.read(artifactId)
    if(format==='preview') {
      const format=officeFormatFor(artifact.kind),file=artifact.exports?.find(item=>item.format===format)
      if(!format||!file)throw new Error(`${format?.toUpperCase()||'Office'} 文件尚未生成，请先完成文件生成`)
      // Viewing never creates/recreates a file or invokes a model, including old
      // artifacts whose text survived an unsuccessful Office export.
      return renderOfficePreview(file.path)
    }
    if(format==='draft') {
      if(!artifact.draft?.text)throw new Error('此成果没有未完成草稿')
      return {format:'txt',fileName:`${artifact.id}-draft.txt`,data:Buffer.from(artifact.draft.text).toString('base64')}
    }
    if(!artifact.content)throw new Error('成果尚未生成内容')
    if(officeFormatFor(artifact.kind)&&artifact.status!=='completed'&&['docx','pptx','xlsx','html','pdf'].includes(format))throw new Error('文件尚未成功导出，请使用“重试导出”；重新生成会再次调用模型')
    let file=artifact.exports?.find(item=>item.format===format)
    if(format==='poster'&&artifact.kind==='video') {
      const video=artifact.exports?.find(item=>item.format==='mp4')
      if(!video)throw new Error('视频尚未生成')
      file=await videoPoster(video)
    }
    if(!file)file=await exportDocument(artifact,artifactExportDirectory(this.#outputRoot,artifact),format)
    return readExportFile({...file,fileName:`${artifact.title.replace(/[<>:\x22/\\|?*\x00-\x1f]/g,'_').slice(0,100).replace(/[. ]+$/,'')||artifact.id}.${format}`})
  }
  async wait(artifactId) {
    const task = this.#tasks.get(artifactId)
    if (task) await task.promise
    return this.read(artifactId,{attempt:true})
  }

  #retryOfficeExport(artifactId) {
    if(this.#tasks.has(artifactId))return Promise.reject(new Error('成果正在处理，请等待当前任务完成'))
    const controller=new AbortController(),signal=controller.signal
    let accept,reject
    const accepted=new Promise((resolve,fail)=>{accept=resolve;reject=fail})
    const promise=Promise.resolve().then(async()=>{
      let started=false,exportState
      try {
        const artifact=await this.#store.read(artifactId)
        if(!canRetryOfficeExport(artifact))throw new Error('此成果没有可恢复的导出失败记录；未完成正文或无效来源草稿不能重试导出')
        if(!this.#ctx.workspaceRegistry.get(artifact.workspaceId))throw new Error('原工作区不可用')
        const contentHash=validateSavedOfficeContent(artifact)
        if(artifact.exportState?.validatedContentHash&&artifact.exportState.validatedContentHash!==contentHash)throw new Error('保存的正文或来源已变化，不能使用原导出校验记录')
        // A governed tool denial must never become an ungoverned Python retry.
        if(artifact.exportState?.provider==='office-tools')throw new Error('此导出使用受管 Office 工具，请从原对话重新执行导出工具以保留权限检查')
        signal.throwIfAborted()
        exportState={version:1,format:officeFormatFor(artifact.kind),validatedContentHash:contentHash,validatedAt:artifact.exportState?.validatedAt||now(),provider:'shared-office',phase:'running',attempts:(artifact.exportState?.attempts||1)+1,lastAttemptAt:now(),recoveredFromLegacy:isLegacyOfficeExportFailure(artifact)||Boolean(artifact.exportState?.recoveredFromLegacy)}
        const running=await this.#store.update(artifactId,{status:'running',phase:'export',message:'正在使用已保存正文重试导出',processed:1,total:2,exportState})
        started=true;accept(running)
        const directory=join(this.#outputRoot,artifactId,'export-'+randomUUID().slice(0,8))
        const file=await exportDocument(artifact,directory,exportState.format,{signal})
        signal.throwIfAborted()
        // Only this successful file attempt changes completion; original model
        // statistics, content, citations and raw draft remain untouched.
        await this.#store.update(artifactId,{status:'completed',phase:'done',processed:2,total:2,message:'',exports:[...(artifact.exports||[]).filter(item=>item.format!==file.format),file],exportState:{...exportState,phase:'complete',completedAt:now()}})
      }catch(error) {
        if(!started){reject(error);return}
        await this.#store.failAttempt(artifactId,{status:signal.aborted?'cancelled':'failed',phase:'done',message:safeMessage(error),exportState:{...exportState,phase:'failed',lastError:safeMessage(error),blocked:deniedExport(error)}})
      }
    }).finally(()=>{this.#tasks.delete(artifactId)})
    this.#tasks.set(artifactId,{controller,promise})
    return accepted
  }

  async start(workspace, kind, parameters, sessionId, signal, execution) {
    const normalized = normalizeParameters(kind, parameters)
    if(['audio','video'].includes(kind)&&this.#ctx.artifactServices?.mediaReadiness) {
      signal?.throwIfAborted()
      const runtime=await this.#ctx.artifactServices.mediaReadiness()
      if(!runtime.available)throw new Error(runtime.reason)
      if(kind==='audio'||normalized.narration!==false&&normalized.narration!=='off') {
        const catalog=await this.#mediaProviders.describe()
        const selected=catalog.speech.find(provider=>provider.id===(normalized.provider||'system'))
        if(!selected?.available||!selected.voices.length)throw new Error('所选语音服务不可用，请重新选择语音服务；视频也可以明确选择不配音。')
        for(const voice of [normalized.voice,normalized.voiceB].filter(Boolean)) {
          if(!selected.voices.some(item=>item.id===voice))throw new Error('所选音色已不可用，请重新选择音色。')
        }
      }
      signal?.throwIfAborted()
    }
    const turn=executionTurn(execution)
    const targetKey=parameters?.targetKey
    if(targetKey!==undefined&&(typeof targetKey!=='string'||!targetKey.trim()||targetKey.length>200))throw new Error('targetKey must be a nonempty string of at most 200 characters')
    const lifecycle=turn?{...turn,callId:String(execution.callId||execution.rootCallId||''),targetKey:targetKey||null}:null
    const artifact = await this.#store.create(workspace, kind, normalized, turn?.sessionId||sessionId, lifecycle, parameters?.retryArtifactId)
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason ?? new Error('Studio generation cancelled'))
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const promise = this.#run(artifact, workspace, sessionId, controller.signal, execution).finally(() => {
      signal?.removeEventListener('abort', abort)
      this.#tasks.delete(artifact.id)
    })
    this.#tasks.set(artifact.id, { controller, promise,sessionId:turn?.sessionId,turn:turn?.turn })
    void promise
    return artifact
  }

  async #run(artifact, workspace, sessionId, signal, execution) {
    let draftText=''
    let generation=null
    let evidenceLabels=null
    let exportState=null
    try {
      const focus = artifact.parameters.focus
      const query = focus || (artifact.kind === 'quiz' ? '核心概念 关键事实 原理 方法 注意事项' : '核心概念 定义 原理 要点 方法')
      const status = this.#manager.status ? await this.#manager.status(workspace) : { indexed: true }
      const task = this.#manager.task?.(workspace.id)
      const useIndex = status.indexed && !['scan', 'write'].includes(task?.phase)
      const evidenceLimit=Math.min(40,(Number(artifact.parameters.count)||6)*3)
      let evidence
      if (useIndex) {
        evidence = (await this.#manager.searchDetailed(workspace, query, { limit: evidenceLimit, pathPrefix:artifact.parameters.pathPrefix, signal })).results
        if (evidence.length < 4 && !artifact.parameters.pathPrefix) evidence = await this.#manager.sample(workspace, evidenceLimit)
      } else {
        evidence = await basicEvidence(this.#ctx.fs, workspace, query, { signal, pathPrefix:artifact.parameters.pathPrefix, limit: evidenceLimit })
      }
      await this.#store.update(artifact.id, { sourceMode: useIndex ? 'index' : 'files', sourceScope: `${useIndex ? '本地索引检索' : '按本次读取的资料生成，最多读取 48 个文件，不代表覆盖整个工作区'} · ${evidence.length} 条来源片段${artifact.parameters.pathPrefix ? ' · 范围：'+artifact.parameters.pathPrefix : ''}` })
      evidence = evidence.filter(item => item.evidenceId).slice(0, 40)
      if (!evidence.length) throw new Error(artifact.parameters.pathPrefix
        ? `输入资料范围 ${JSON.stringify(artifact.parameters.pathPrefix)} 内没有可引用内容。pathPrefix 是工作区内已有的输入文件或目录，不是 Studio 输出位置。请核对实际资料路径，修正或清空 pathPrefix 后用同一 artifactId 重试；不要改成其他成果类型。无需先建立索引。`
        : '当前工作区没有足够的可引用内容。请检查原始资料是否存在且可读取；无需先建立索引。')
      const bundle=createEvidenceBundle(evidence)
      evidence=bundle.evidence
      evidenceLabels=bundle.labels
      await this.#store.update(artifact.id, { phase: 'generate', processed: 1, total: 2 })
      const common = `输出语言：${artifact.parameters.language}。受众：${artifact.parameters.audience || '一般读者'}。难度：${artifact.parameters.difficulty || '适中'}。主题偏好：${focus || '覆盖工作区最重要的内容'}\n引用规则：引用为可选；没有对应来源就省略 evidenceIds，不要补造。evidenceIds 只能填写本次资料给出的短标签（例如 ["S1","S2"]）；不要生成或复制长哈希，不得猜测不存在的 S 编号。来源标签只放在 evidenceIds 中，正文不写编号。\n\nEvidence Bundle：\n${bundle.text}`
      let generated
      if (artifact.kind === 'quiz') {
        const difficulty = { easy: '基础', medium: '中等', hard: '进阶' }[artifact.parameters.difficulty]
        const result = await generateText(this.#ctx, {
          sessionId, signal, purpose: 'knowledge-studio-quiz',
          system: '你是严谨的学习测验编辑。只能使用 Evidence Bundle，不得编造事实或引用。干扰项应可信但可由证据明确排除。只输出严格 JSON，不调用工具。',
          prompt: `生成 ${artifact.parameters.count} 道${difficulty}难度的单选题。题目覆盖不同知识点，避免仅考文件名或无意义细节。${common}\n\n输出：{"title":"测验标题","questions":[{"question":"题干","options":["选项A","选项B","选项C","选项D"],"correctIndex":0,"explanation":"基于证据的解释","evidenceIds":["S1"]}]}。correctIndex 从 0 开始；资料较少时允许少于请求题数；只填写确有对应依据的 evidenceIds。`,
        })
        draftText=result.text;generation=result.generation??null
        generated = validateQuiz(bundle.restore(artifact.kind,result.text), evidence, artifact.parameters.count)
      } else if (artifact.kind === 'flashcards') {
        const result = await generateText(this.#ctx, {
          sessionId, signal, purpose: 'knowledge-studio-flashcards',
          system: '你是严谨的学习卡片编辑。只能使用 Evidence Bundle，不得编造事实或引用。卡片正面应提出一个清晰问题，背面给出简洁且充分的答案。只输出严格 JSON，不调用工具。',
          prompt: `生成 ${artifact.parameters.count} 张抽认卡，覆盖不同知识点。${common}\n\n输出：{"title":"卡片标题","cards":[{"front":"正面问题","back":"背面答案","evidenceIds":["S1"]}]}。资料较少时允许少于请求卡片数；只填写确有对应依据的 evidenceIds。`,
        })
        draftText=result.text;generation=result.generation??null
        generated = validateFlashcards(bundle.restore(artifact.kind,result.text), evidence, artifact.parameters.count)
      } else {
        const result=await generateText(this.#ctx,{
          sessionId,signal,purpose:`knowledge-studio-${artifact.kind}`,
          system:'你是资料驱动的内容编辑。只依据提供的来源，缺失信息明确说明。输出严格 JSON。标题、引用、备注为可选，缺少则省略，不为补齐格式编造内容。不得执行或输出可执行代码。',
          prompt:`${(await readCreationGuidance(artifact.kind,{signal})).map(ref=>`共享创作参考（${ref.source}）：\n${ref.markdown}`).join('\n\n')}\n\n${studioInstructions(artifact.kind,artifact.parameters)}\n${common}\n输出格式：${CONTENT_SCHEMAS[artifact.kind]}`,
        })
        draftText=result.text;generation=result.generation??null
        generated=validateContent(artifact.kind,bundle.restore(artifact.kind,result.text),evidence)
      }
      const used = new Set(contentItems(generated).flatMap(item => item.evidenceIds))
      const citations = []
      for (const item of evidence.filter(value => used.has(value.evidenceId))) {
        const current = item.evidenceId.startsWith('file_') ? item : await this.#manager.readEvidence(workspace, item.evidenceId)
        if (current) citations.push(citationSnapshot(current))
      }
      const savedSources=new Set(citations.map(citation=>citation.evidenceId))
      for(const item of contentItems(generated))item.evidenceIds=item.evidenceIds.filter(id=>savedSources.has(id))
      const interaction = artifact.kind === 'quiz' ? { current: 0, answers: {}, revealed: {} } : { current: 0, flipped: false, grades: {} }
      const ready={...artifact,title:generated.title,content:generated,citations,interaction,generation}
      const officeFormat=officeFormatFor(artifact.kind)
      if(officeFormat)exportState={version:1,format:officeFormat,validatedContentHash:validateSavedOfficeContent(ready),validatedAt:now(),provider:execution?.agent&&this.#ctx.tools?.get({docx:'office_document',pptx:'office_presentation',xlsx:'office_spreadsheet'}[officeFormat])?'office-tools':'shared-office',phase:'running',attempts:1,lastAttemptAt:now()}
      await this.#store.update(artifact.id,{...ready,phase:'export',...(exportState?{exportState}:{})})
      const exports=[]
      const exportDirectory=artifactExportDirectory(this.#outputRoot,artifact)
      if(['audio','video'].includes(artifact.kind)) {
        const media=await renderMedia(ready,exportDirectory,signal,message=>{void this.#store.update(artifact.id,{phase:'render',message}).catch(error=>this.#ctx.logger?.warn?.('Studio progress persistence failed',error))},this.#mediaProviders,{sessionId,workspace,execution})
        const {attachments=[],...file}=media
        exports.push(file,...attachments)
      }
      if(officeFormat) {
        const directory=exportDirectory
        exports.push(await exportWithOfficeTools(this.#ctx,ready,directory,officeFormat,{execution,signal}) || await exportDocument(ready,directory,officeFormat,{signal}))
      }
      signal.throwIfAborted()
      await this.#store.update(artifact.id, { status: 'completed', phase: 'done', processed: 2, total: 2, exports, message: '',...(exportState?{exportState:{...exportState,phase:'complete',completedAt:now()}}:{}) })
    } catch (error) {
      const partialText=error?.partialText||draftText
      await this.#store.failAttempt(artifact.id, { status: signal.aborted ? 'cancelled' : 'failed', phase: 'done', message: safeMessage(error),generation:error?.generation??generation,...(exportState?{exportState:{...exportState,phase:'failed',lastError:safeMessage(error),blocked:deniedExport(error)}}:{}),...(partialText?{draft:{text:partialText,format:'json',reason:exportState?'export':error?.code==='STUDIO_OUTPUT_LIMIT'?'output-limit':error?.partialText?'interrupted':'validation',generation:error?.generation??generation,evidenceLabels}}:{}) })
    }
  }

  async askPrompt(artifactId, itemId) {
    const artifact = await this.read(artifactId)
    if(artifact.kind==='mindmap'&&itemId) {
      const {byId}=mindmapTree(artifact.content),node=byId.get(itemId)
      if(!node)throw new Error('找不到所选导图节点')
      const path=[node.label];let parent=node.parentId
      while(parent){const item=byId.get(parent);path.unshift(item.label);parent=item.parentId}
      const sources=artifact.citations.filter(citation=>node.evidenceIds?.includes(citation.evidenceId)).map(citation=>`${citation.path}（${citation.locator==='page'?'P'+citation.pageStart:'L'+citation.lineStart}）：${citation.excerpt||citation.content||''}`).join('\n')
      return `请结合当前工作区，讨论思维导图「${artifact.title}」中的节点「${node.label}」。\n主题路径：${path.join(' → ')}\n节点说明：${node.body||'暂无'}${node.children.length?'\n子主题：'+node.children.map(child=>child.label).join('、'):''}\n可核验来源：\n${sources||'该节点未保存可用来源'}`
    }
    if (!['quiz','flashcards'].includes(artifact.kind)) return `请基于当前工作区，继续讨论或按我的要求修改 Studio 成果 ${artifact.id}（${artifact.title}），条目 ${itemId || '全部'}。内容：${JSON.stringify(artifact.content).slice(0,20000)}。保留来源依据；需要新版本时调用 knowledge_studio_create_artifact。`
    const items = artifact.kind === 'quiz' ? artifact.content?.questions : artifact.content?.cards
    const item = items?.find(value => value.id === itemId)
    if (!item) throw new Error(`Unknown artifact item: ${itemId}`)
    const citations = artifact.citations.filter(citation => item.evidenceIds.includes(citation.evidenceId))
    const subject = artifact.kind === 'quiz'
      ? `题目：${item.question}\n选项：${item.options.map((value, index) => `${String.fromCharCode(65 + index)}. ${value}`).join('\n')}\n已有解释：${item.explanation}`
      : `卡片正面：${item.front}\n卡片背面：${item.back}`
    const sources = citations.map(citation => `${citation.path}（${citation.locator === 'page' ? `第 ${citation.pageStart} 页` : `第 ${citation.lineStart}-${citation.lineEnd} 行`}）`).join('；')
    const choice = artifact.interaction?.answers?.[itemId]
    const identity = `成果：${artifact.id}；条目：${itemId}；我的选择：${choice == null ? '尚未选择' : String.fromCharCode(65 + choice)}`
    return `${identity}\n\n请结合当前工作区，进一步解释下面这项学习内容，并指出容易误解之处。\n\n${subject}\n\n可核验来源：${sources}`
  }

  async close() {
    for (const task of this.#tasks.values()) task.controller.abort(new Error('Knowledge Studio is stopping'))
    await Promise.allSettled([...this.#tasks.values()].map(task => task.promise))
    await Promise.allSettled([...this.#settlements])
    this.#tasks.clear()
  }
}

export { normalizeParameters, validateFlashcards, validateQuiz }
