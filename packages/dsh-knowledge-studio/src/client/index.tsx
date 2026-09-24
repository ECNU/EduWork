import {KnowledgeSurface, type Target, type SessionMemory} from './KnowledgeSurface'
import {StudioIcon} from './StudioIcon'
import {artifactRequest} from '../../lib/studio-instructions.js'
import {StudioEntry,StudioHeaderEntry,StudioBlankEntry} from './StudioEntry'
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {KnowledgeMarkdown as Markdown} from './KnowledgeMarkdown'

import { knowledgeStudioRemote } from './remote.js'
import { StudioArtifact } from './StudioArtifact.js'
import { WorkspaceHome } from './WorkspaceHome.js'
import { ReadingFrame, ReadingLayer } from './ReadingFrame.js'
// @ts-expect-error Host capability descriptors are shared browser-safe data.
import { BUILTIN_CAPABILITIES } from '../../lib/capabilities.js'

export const inject = ['slots', 'remote', 'sessions', 'layout']
const zh =
  typeof navigator !== 'undefined' &&
  navigator.language.toLowerCase().startsWith('zh')

const t = zh
  ? {
      loading: '正在读取…',
      noWorkspace: '当前会话不属于任何工作区。',
      failed: '生成失败',
      cancel: '取消任务',
      openSource: '打开原文',
      back: '返回',
      close: '关闭 Studio',
      working: '处理中',
      error: '操作失败',
      generate: '开始生成',
      generating: '正在生成',
      interruptedArtifact: '生成被中断',
      askAI: '问问 AI',
      evidence: '查看依据',
      submitAnswer: '提交答案',
      next: '下一个',
      previous: '上一个',
      correct: '回答正确',
      incorrect: '回答错误',
      flip: '翻到背面',
      known: '已掌握',
      review: '再复习',
      reset: '重新开始',
    }
  : {
      loading: 'Loading…',
      noWorkspace: 'This session is not attached to a workspace.',
      failed: 'Generation failed',
      cancel: 'Cancel task',
      openSource: 'Open source',
      back: 'Back',
      close: 'Close Studio',
      working: 'Working',
      error: 'Operation failed',
      generate: 'Generate',
      generating: 'Generating',
      interruptedArtifact: 'Generation interrupted',
      askAI: 'Ask AI',
      evidence: 'View evidence',
      submitAnswer: 'Submit answer',
      next: 'Next',
      previous: 'Previous',
      correct: 'Correct',
      incorrect: 'Incorrect',
      flip: 'Show answer',
      known: 'Got it',
      review: 'Review again',
      reset: 'Start over',
    }

async function unwrap<T = any>(operation: Promise<any>): Promise<T> {
  const result = await operation
  if (result?.ok === true) return result.value as T
  throw new Error(
    result?.error?.message || result?.error?.code || 'Remote operation failed',
  )
}

// One outstanding snapshot per service/path, even if several surfaces subscribe.
const workspaceRequests = new WeakMap<object, Map<string, Promise<any>>>()
function workspaceRequest(service: any, cwd: string) {
  let requests = workspaceRequests.get(service)
  if (!requests) workspaceRequests.set(service, requests = new Map())
  let request = requests.get(cwd)
  if (!request) {
    request = unwrap(service.workspaceForPath(cwd))
    requests.set(cwd, request)
    void request.finally(() => requests!.delete(cwd)).catch(() => {})
  }
  return request
}
function pendingWorkspace(cwd: string) {
  return { id: '', path: cwd, title: cwd.split(/[\\/]/).filter(Boolean).at(-1), unknown: true,
    capabilities: BUILTIN_CAPABILITIES, artifacts: [] }
}
function useWorkspace(service: any, cwd: string) {
  const [value, setValue] = useState<any>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    setValue(null)
    setError('')
    const load = async () => {
      const warning = setTimeout(() => {
        if (!disposed) setError(zh ? '工作区服务响应较慢，基础创作仍可使用。' : 'Workspace service is slow. Basic creation remains available.')
      }, 8000)
      try {
        const result = await workspaceRequest(service, cwd)
        if (!disposed) { setValue(result ? { ...result, requestedCwd: cwd } : result); setError(result ? '' : t.noWorkspace) }
      } catch {
        if (!disposed) setError(zh ? '无法连接工作区服务，请重试。' : 'Cannot connect to workspace service. Retry.')
      } finally {
        clearTimeout(warning)
        if (!disposed) timer = setTimeout(load, 2000)
      }
    }
    if (cwd) void load()
    return () => { disposed = true; clearTimeout(timer) }
  }, [service, cwd, retry])
  return { workspace: value?.requestedCwd === cwd ? value : pendingWorkspace(cwd),
    error, refresh: () => setRetry(value => value + 1) }
}

const colors = {
  border: 'var(--dsw-alias-border-l2, #e3d9d4)',
  bg: 'var(--dsw-alias-bg-layer-1, #fff)',
  soft: 'var(--dsw-alias-bg-layer-2, #f7f3f1)',
  text: 'var(--dsw-alias-label-primary, #251c19)',
  muted: 'var(--dsw-alias-label-secondary, #746965)',
  accent: 'var(--dsw-alias-state-business-primary, #963442)',
  green: 'var(--dsw-alias-state-success-primary, #397a56)',
  amber: 'var(--dsw-alias-state-warn-label, #936d13)',
  red: 'var(--dsw-alias-state-error-primary, #ad2c3b)',
}
const button: React.CSSProperties = {
  minHeight: 32,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: '5px 10px',
  background: colors.bg,
  color: colors.text,
  cursor: 'pointer',
  fontFamily: 'inherit',
}
const primaryButton: React.CSSProperties = {
  ...button,
  borderColor: colors.accent,
  background: colors.accent,
  color: 'var(--dsw-alias-label-primary-inverted, #fff)',
}
const field: React.CSSProperties = {
  width: '100%',
  minHeight: 36,
  border: `1px solid ${colors.border}`,
  borderRadius: 9,
  padding: '7px 9px',
  color: colors.text,
  background: colors.bg,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}

function SidebarIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M15 4v16" />
    </svg>
  )
}

function location(value: any) {
  if (value.locator === 'page')
    return `p.${value.pageStart}${value.pageEnd && value.pageEnd !== value.pageStart ? `–${value.pageEnd}` : ''}`
  return `L${value.lineStart ?? '?'}${value.lineEnd && value.lineEnd !== value.lineStart ? `–${value.lineEnd}` : ''}`
}

function parameterVisible(parameter:any,values:Record<string,any>) {
  return (!parameter.when || Object.entries(parameter.when).every(([key,value])=>values[key]===value)) && (!parameter.whenNot || Object.entries(parameter.whenNot).every(([key,value])=>values[key]!==value)) && (!parameter.whenNonempty || Boolean(values[parameter.whenNonempty]))
}
function ParameterDialog({ capability, busy, close, submit }: any) {
  const [values, setValues] = useState<Record<string, any>>(() =>
    Object.fromEntries(
      (capability.parameters ?? []).map((parameter: any) => [
        parameter.id,
        parameter.default,
      ]),
    ),
  )
  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2200,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: 'rgba(32,24,22,.32)',
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={capability.title}
        onSubmit={(event) => {
          event.preventDefault()
          void submit(values)
        }}
        style={{
          width: 'min(640px, calc(100vw - 40px))',
          maxHeight: 'min(720px, calc(100vh - 40px))',
          display: 'grid',
          gridTemplateRows: '56px minmax(0,1fr) 60px',
          overflow: 'hidden',
          border: `1px solid ${colors.border}`,
          borderRadius: 16,
          background: colors.bg,
          color: colors.text,
          boxShadow: '0 22px 70px rgba(36,23,20,.22)',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 18px',
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <StudioIcon kind={capability.id} />
          <strong>{capability.title}</strong>
          <button
            type="button"
            aria-label={t.close}
            onClick={close}
            style={{ ...button, marginLeft: 'auto', border: 0, fontSize: 17 }}
          >
            ×
          </button>
        </header>
        <div style={{ overflow: 'auto', padding: '18px' }}>
          {(capability.parameters ?? []).filter((p:any)=>parameterVisible(p,values)).map((parameter: any) => (
            <label
              key={parameter.id}
              style={{ display: 'block', marginBottom: 17 }}
            >
              <strong
                style={{ display: 'block', marginBottom: 7, fontSize: 12 }}
              >
                {parameter.label}
              </strong>
              {parameter.type === 'select' ? (
                <select
                  style={field}
                  value={values[parameter.id]}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [parameter.id]: event.target.value,
                      ...(parameter.id==='provider'?{voice:'',voiceB:''}:{}),
                    }))
                  }
                >
                  {parameter.options.filter((o:any)=>parameterVisible(o,values)).map((option: any) => (
                    <option key={String(option.value)} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : parameter.type === 'text' ? (
                <input style={field} value={values[parameter.id] ?? ''} placeholder={parameter.placeholder} onChange={event=>setValues(current=>({...current,[parameter.id]:event.target.value}))}/>
              ) : (
                <textarea
                  autoFocus
                  style={{ ...field, minHeight: 120, resize: 'vertical' }}
                  value={values[parameter.id] ?? ''}
                  placeholder={parameter.placeholder}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [parameter.id]: event.target.value,
                    }))
                  }
                />
              )}
            </label>
          ))}
        </div>
        <footer
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 8,
            padding: '0 18px',
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          <button type="button" style={button} onClick={close}>
            {t.cancel}
          </button>
          <button type="submit" disabled={busy} style={primaryButton}>
            {busy ? t.working : t.generate}
          </button>
        </footer>
      </form>
    </div>
  )
}

function ArtifactShell({ artifact, children }: any) {
  return <section data-knowledge-studio-artifact="true" style={{height:'100%',overflow:'auto',padding:'16px',boxSizing:'border-box',background:colors.bg,color:colors.text}}>
    {artifact?.sourceScope && <p style={{color:colors.muted,fontSize:11}}>{artifact.sourceScope}</p>}
    {children}
  </section>
}
function ArtifactPanel({ artifact, back, close, update, askAI, showEvidence }: any) {
  if (!artifact)
    return (
      <ArtifactShell artifact={null} back={back} close={close}>
        <p>{t.loading}</p>
      </ArtifactShell>
    )
  if (['running', 'queued'].includes(artifact.status))
    return (
      <ArtifactShell artifact={artifact} back={back} close={close}>
        <div style={{ marginTop: '20vh', textAlign: 'center' }}>
          <span
            style={{
              display: 'inline-grid',
              width: 44,
              height: 44,
              placeItems: 'center',
              borderRadius: 14,
              color: colors.accent,
              background: colors.soft,
            }}
          >
            ◌
          </span>
          <h2 style={{ fontSize: 18 }}>{t.generating}</h2>
          <p style={{ color: colors.muted, fontSize: 11 }}>
            {artifact.phase === 'retrieve'
              ? '正在检索可核验内容'
              : '正在组织交互内容'}
            {artifact.total ? ` · ${artifact.processed}/${artifact.total}` : ''}
          </p>
        </div>
      </ArtifactShell>
    )
  if (['failed', 'interrupted', 'cancelled'].includes(artifact.status))
    return (
      <ArtifactShell artifact={artifact} back={back} close={close}>
        <div style={{ marginTop: '16vh', textAlign: 'center' }}>
          <h2 style={{ color: colors.red, fontSize: 18 }}>
            {artifact.status === 'interrupted'
              ? t.interruptedArtifact
              : t.failed}
          </h2>
          <p style={{ color: colors.muted, fontSize: 11 }}>
            {artifact.message}
          </p>
        </div>
      </ArtifactShell>
    )

  const citation = (id: string) =>
    artifact.citations?.find((item: any) => item.evidenceId === id)
  if (artifact.kind === 'quiz') {
    const questions = artifact.content?.questions ?? []
    const current = Math.max(
      0,
      Math.min(
        questions.length - 1,
        Number(artifact.interaction?.current) || 0,
      ),
    )
    const question = questions[current]
    if (!question)
      return (
        <ArtifactShell artifact={artifact} back={back} close={close}>
          <p>{t.error}</p>
        </ArtifactShell>
      )
    const answer = artifact.interaction?.answers?.[question.id]
    const revealed = Boolean(artifact.interaction?.revealed?.[question.id])
    const correct = revealed && Number(answer) === Number(question.correctIndex)
    const completed = questions.filter(
      (item: any) => artifact.interaction?.revealed?.[item.id],
    ).length
    return (
      <ArtifactShell artifact={artifact} back={back} close={close}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div style={{ display: 'flex', color: colors.muted, fontSize: 10 }}>
            <span>
              {current + 1}/{questions.length}
            </span>
            <span style={{ marginLeft: 'auto' }}>
              {completed}/{questions.length}
            </span>
          </div>
          <div
            style={{
              height: 3,
              margin: '8px 0 24px',
              borderRadius: 3,
              overflow: 'hidden',
              background: colors.soft,
            }}
          >
            <div
              style={{
                width: `${((current + 1) / questions.length) * 100}%`,
                height: '100%',
                background: colors.accent,
              }}
            />
          </div>
          <h2 style={{ fontSize: 18, lineHeight: 1.5 }}>{question.question}</h2>
          <div style={{ display: 'grid', gap: 9, marginTop: 18 }}>
            {question.options.map((option: string, index: number) => {
              const selected = Number(answer) === index
              const isCorrect = revealed && index === question.correctIndex
              const wrong = revealed && selected && !isCorrect
              return (
                <button
                  key={index}
                  disabled={revealed}
                  onClick={() => void update('answer', question.id, index)}
                  style={{
                    ...button,
                    minHeight: 48,
                    padding: '10px 12px',
                    textAlign: 'left',
                    borderColor: isCorrect
                      ? colors.green
                      : wrong
                        ? colors.red
                        : selected
                          ? colors.accent
                          : colors.border,
                    background: isCorrect
                      ? 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 11%, transparent)'
                      : wrong
                        ? 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent)'
                        : selected
                          ? colors.soft
                          : colors.bg,
                  }}
                >
                  <strong style={{ marginRight: 9 }}>
                    {String.fromCharCode(65 + index)}.
                  </strong>
                  {option}
                </button>
              )
            })}
          </div>
          {!revealed && (
            <button
              disabled={answer == null}
              onClick={() => void update('reveal', question.id, true)}
              style={{ ...primaryButton, marginTop: 16 }}
            >
              {t.submitAnswer}
            </button>
          )}
          {revealed && (
            <section
              style={{
                marginTop: 18,
                padding: 14,
                borderRadius: 11,
                border: `1px solid ${correct ? colors.green : colors.red}`,
                background: correct
                  ? 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent)'
                  : 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, transparent)',
              }}
            >
              <strong style={{ color: correct ? colors.green : colors.red }}>
                {correct ? `✓ ${t.correct}` : `× ${t.incorrect}`}
              </strong>
              <p style={{ margin: '8px 0 0', lineHeight: 1.65, fontSize: 12 }}>
                {question.explanation}
              </p>
              <div
                style={{
                  display: 'flex',
                  gap: 7,
                  flexWrap: 'wrap',
                  marginTop: 11,
                }}
              >
                {question.evidenceIds.map((id: string, index: number) => (
                  <button
                    key={id}
                    style={button}
                    onClick={() => void showEvidence(citation(id))}
                  >
                    {t.evidence} {index + 1}
                  </button>
                ))}
                <button style={button} onClick={() => void askAI(question.id)}>
                  {t.askAI}
                </button>
              </div>
            </section>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
            <button
              disabled={current === 0}
              style={button}
              onClick={() => void update('current', question.id, current - 1)}
            >
              {t.previous}
            </button>
            <button
              disabled={current >= questions.length - 1}
              style={{ ...primaryButton, marginLeft: 'auto' }}
              onClick={() => void update('current', question.id, current + 1)}
            >
              {t.next}
            </button>
          </div>
          {completed === questions.length && (
            <button
              style={{ ...button, width: '100%', marginTop: 12 }}
              onClick={() => void update('reset', '', true)}
            >
              {t.reset}
            </button>
          )}
          {questions.some((q:any)=>artifact.interaction?.revealed?.[q.id] && artifact.interaction?.answers?.[q.id]!==q.correctIndex) && <details style={{marginTop:18}}><summary style={{cursor:'pointer'}}>错题回顾</summary>{questions.map((q:any,index:number)=>artifact.interaction?.revealed?.[q.id] && artifact.interaction?.answers?.[q.id]!==q.correctIndex ? <button key={q.id} style={{...button,display:'block',textAlign:'left',marginTop:8,width:'100%'}} onClick={()=>void update('current',q.id,index)}>{index+1}. {q.question}</button>:null)}</details>}
        </div>
      </ArtifactShell>
    )
  }

  const cards = artifact.content?.cards ?? []
  const current = Math.max(
    0,
    Math.min(cards.length - 1, Number(artifact.interaction?.current) || 0),
  )
  const card = cards[current]
  if (!card)
    return (
      <ArtifactShell artifact={artifact} back={back} close={close}>
        <p>{t.error}</p>
      </ArtifactShell>
    )
  const flipped = Boolean(artifact.interaction?.flipped)
  const grades = artifact.interaction?.grades ?? {}
  const known = Object.values(grades).filter(Boolean).length
  const grade = async (value: boolean) => {
    await update('grade', card.id, value)
    if (current < cards.length - 1)
      await update('current', card.id, current + 1)
  }
  return (
    <ArtifactShell artifact={artifact} back={back} close={close}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', color: colors.muted, fontSize: 10 }}>
          <span>
            {current + 1}/{cards.length}
          </span>
          <span style={{ marginLeft: 'auto' }}>
            {known} {t.known}
          </span>
        </div>
        <button
          onClick={() => void update('flip', card.id, !flipped)}
          style={{
            width: '100%',
            minHeight: 300,
            display: 'grid',
            placeItems: 'center',
            marginTop: 16,
            padding: 30,
            border: `1px solid ${flipped ? colors.accent : colors.border}`,
            borderRadius: 18,
            background: flipped ? colors.soft : colors.bg,
            color: colors.text,
            cursor: 'pointer',
            fontFamily: 'inherit',
            boxShadow: '0 10px 30px rgba(36,23,20,.06)',
          }}
        >
          <span
            style={{
              maxWidth: 560,
              fontSize: flipped ? 16 : 20,
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
            }}
          >
            {flipped ? card.back : card.front}
          </span>
        </button>
        <p style={{ textAlign: 'center', color: colors.muted, fontSize: 10 }}>
          {flipped ? '' : t.flip}
        </p>
        {flipped && (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 9,
                marginTop: 14,
              }}
            >
              <button style={button} onClick={() => void grade(false)}>
                {t.review}
              </button>
              <button style={primaryButton} onClick={() => void grade(true)}>
                {t.known}
              </button>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 7,
                flexWrap: 'wrap',
                marginTop: 12,
              }}
            >
              {card.evidenceIds.map((id: string, index: number) => (
                <button
                  key={id}
                  style={button}
                  onClick={() => void showEvidence(citation(id))}
                >
                  {t.evidence} {index + 1}
                </button>
              ))}
              <button style={button} onClick={() => void askAI(card.id)}>
                {t.askAI}
              </button>
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
          <button
            disabled={current === 0}
            style={button}
            onClick={() => void update('current', card.id, current - 1)}
          >
            {t.previous}
          </button>
          <button
            disabled={current >= cards.length - 1}
            style={{ ...button, marginLeft: 'auto' }}
            onClick={() => void update('current', card.id, current + 1)}
          >
            {t.next}
          </button>
        </div>
        {Object.keys(grades).length === cards.length && (
          <button
            style={{ ...button, width: '100%', marginTop: 12 }}
            onClick={() => void update('reset', '', true)}
          >
            {t.reset}
          </button>
        )}
      </div>
    </ArtifactShell>
  )
}

function DetailsPanel({
  sessionId:providedSessionId,
  useSession,
  useInput,
  inputActions,
  surface,
  service,
  sessionMeta,
  openFile,
  closePanel,
  officialSidebar,
  notificationNavigation,
  notificationVisible,
}: any) {
  const sessionId = providedSessionId??useSession((snapshot: any) => snapshot.sessionId)
  const draft = useInput((snapshot:any)=>snapshot.draft)
  const meta = sessionMeta(sessionId)
  const remembered = surface.sessionState(sessionId)
  const { workspace, error: workspaceError, refresh } = useWorkspace(service, meta.cwd)
  const [evidence, setEvidenceState] = useState<any>(
    remembered.artifactId ? remembered.evidence || null : null,
  )
  const [artifactId, setArtifactIdState] = useState(remembered.artifactId || '')
  const [artifact, setArtifact] = useState<any>(null)
  const [dialog, setDialog] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const remember = (patch: SessionMemory) => surface.remember(sessionId, patch)
  const setEvidence = (value: any) => {
    setEvidenceState(value)
    remember({ evidence: value })
  }
  const setArtifactId = (value: string) => {
    setArtifactIdState(value)
    remember({ artifactId: value })
  }

  useEffect(() => {
    const id = notificationNavigation?.params?.artifactId
    if (typeof id !== 'string' || !/^artifact_[a-f0-9]{32}$/.test(id)) return
    setEvidence(null)
    setDialog(null)
    setArtifactId(id)
  }, [notificationNavigation?.revision, sessionId])

  useEffect(() => {
    if (!artifactId || notificationVisible !== true) return
    const report = (visible: boolean) => window.dispatchEvent(new CustomEvent('eduwork:studio-visibility', { detail: { sessionId, artifactId, visible } }))
    report(true)
    return () => { report(false) }
  }, [sessionId, artifactId, notificationVisible])

  useEffect(() => {
    let disposed = false
    if (!artifactId) {
      setArtifact(null)
      return () => {
        disposed = true
      }
    }
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const value = await unwrap<any>(service.readArtifact(artifactId))
        if (!disposed) setArtifact(value.artifact)
      } catch (cause: any) {
        if (!disposed) setError(cause?.message || String(cause))
      } finally {
        if (!disposed) timer = setTimeout(load, 2000)
      }
    }
    void load()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [artifactId])

  useEffect(() => {
    const since = surface.sessionState(sessionId).awaitingArtifactSince
    if (!since) return
    const result = workspace.artifacts?.find((item: any) => item.sessionId === sessionId && item.createdAt >= since)
    if (result) {
      setArtifactId(result.id)
      surface.remember(sessionId, { awaitingArtifactSince: undefined })
    }
  }, [workspace.artifacts, sessionId])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (cause: any) {
      setError(cause?.message || String(cause))
    } finally {
      setBusy(false)
    }
  }
  const showEvidence = (item: any) =>
    run(async () => {
      const id = item.evidenceId
      const value = id && !id.startsWith('file_')
        ? (await unwrap<any>(service.readEvidence(workspace.id, id))).evidence
        : item
      setEvidence(
        value
          ? { ...value, path: value.path || item.path, content: value.content || value.excerpt || item.excerpt }
          : { ...item, content: item.content || item.excerpt || '原始内容已经变化。' },
      )
    })
  const invoke = (capability: any, parameters: any = {}) =>
    run(async () => {
      if (capability.execution === 'conversation') {
        inputActions.setDraft(capability.prompt || BUILTIN_CAPABILITIES.find((item: any) => item.id === capability.id)?.prompt)
        inputActions.submit()
        return
      }
      if (capability.execution === 'artifact') {
        surface.setReading(false)
        surface.remember(sessionId, { awaitingArtifactSince: new Date().toISOString(), artifactId: '' })
        setDialog(null)
        setArtifactId('')
        inputActions.setDraft(artifactRequest(capability, parameters))
        inputActions.submit()
        return
      }
      const target = workspace.id ? workspace : await workspaceRequest(service, meta.cwd)
      if (!target?.id) throw new Error(t.noWorkspace)
      const result = await unwrap<any>(
        service.invokeStudio(
          target.id,
          capability.id,
          parameters,
          sessionId,
        ),
      )
      if (result.action === 'compose') {
        inputActions.setDraft(result.prompt)
        inputActions.submit()
        surface.close()
        closePanel?.()
        return
      }
      if (result.action === 'artifact') {
        setDialog(null)
        setArtifact(result.artifact)
        setArtifactId(result.artifact.id)
        return
      }
      await refresh()
    })
  const updateArtifact = async (action: string, itemId: string, value: any) => {
    const result = await unwrap<any>(
      service.updateArtifactInteraction(artifact.id, action, itemId, value),
    )
    setArtifact(result.artifact)
  }
  const askArtifact = async (itemId: string) => {
    const result = await unwrap<any>(
      service.artifactAskPrompt(artifact.id, itemId),
    )
    inputActions.setDraft(artifact.kind==='mindmap'?`${draft?draft+'\n\n':''}${result.prompt}\n\n我的问题：`:result.prompt)
    if(artifact.kind!=='mindmap')inputActions.submit()
    surface.setReading(false)
  }

  const close = () =>
    closePanel ? closePanel() : surface.dismiss(meta)
  if (!meta.cwd)
    return (
      <div style={{ padding: 20, color: colors.muted }}>{t.noWorkspace}</div>
    )
  if (evidence)
    return (
      <section
        style={{
          height: '100%',
          display: 'grid',
          gridTemplateRows: '52px minmax(0,1fr)',
          background: colors.bg,
          color: colors.text,
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 13px',
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <button
            style={{ ...button, border: 0 }}
            onClick={() => setEvidence(null)}
          >
            ← {t.back}
          </button>
          <strong
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {evidence.heading || evidence.path}
          </strong>
          <button
            aria-label={t.close}
            style={{ ...button, marginLeft: 'auto', border: 0 }}
            onClick={close}
          >
            ×
          </button>
        </header>
        <div style={{ padding: 18, overflow: 'auto' }}>
          <div style={{ color: colors.muted, fontSize: 11 }}>
            {evidence.path} · {location(evidence)}
          </div>
          {evidence.fresh === false && <p role="alert">原文件已经变化或不可用，当前显示生成时的资料快照。</p>}
          <div data-studio-evidence-content style={{fontSize:14,margin:'16px 0'}}><Markdown page={{content:evidence.content}}/></div>
          {error && <p role="alert">{error}</p>}
          <button
            style={button}
            onClick={() => void run(() => openFile(workspace.path, evidence.path))}
          >
            {t.openSource}
          </button>
        </div>
      </section>
    )

  if (artifactId)
    return (
      <StudioArtifact artifact={artifact?.id===artifactId?artifact:null} back={()=>setArtifactId('')} close={close}
        expanded={!officialSidebar&&surface.getSnapshot().reading} expand={officialSidebar?undefined:()=>surface.setReading(true)}
        memory={surface.sessionState(sessionId).mindmaps?.[artifactId]}
        remember={(value:any)=>surface.remember(sessionId,{mindmaps:{...surface.sessionState(sessionId).mindmaps,[artifactId]:value}})}
        showEvidence={showEvidence} askAI={askArtifact}
        exportFile={async(format:string)=>(await unwrap<any>(service.exportArtifact(artifactId,format))).file}
        manage={async(action:string,value:string)=>{
          if(action==='retry') {
            surface.setReading(false)
            const capability=workspace.capabilities.find((c:any)=>c.id===artifact.kind)
            surface.remember(sessionId,{awaitingArtifactSince:new Date().toISOString(),artifactId:''})
            inputActions.setDraft(artifactRequest(capability,artifact.parameters));inputActions.submit();return
          }
          const result=await unwrap<any>(service.manageArtifact(artifactId,action,value,sessionId))
          if(action==='delete')setArtifactId('');else setArtifact(result.artifact)
          await refresh()
        }}>
      <ArtifactPanel
        artifact={artifact}
        back={() => setArtifactId('')}
        close={close}
        update={updateArtifact}
        askAI={askArtifact}
        showEvidence={showEvidence}
      />
      </StudioArtifact>
    )

  return <>
    <WorkspaceHome {...{workspace,refresh,close}}
      scrollPositions={surface.sessionState(sessionId).scrollPositions}
      rememberScroll={(key:string,value:number)=>surface.remember(sessionId,{scrollPositions:{...surface.sessionState(sessionId).scrollPositions,[key]:value}})}
      error={error||workspaceError}
      invoke={(capability:any)=>setDialog(capability)} openArtifact={setArtifactId}/>
    {dialog&&<ParameterDialog capability={dialog} busy={busy} close={()=>setDialog(null)} submit={(parameters:any)=>invoke(dialog,parameters)}/>}
  </>
}

function SessionDetails(props: any) {
  const sessionId = props.sessionId??props.useSession((value: any) => value.sessionId)
  const state:any=useSyncExternalStore(props.surface.subscribe,props.surface.getSnapshot,props.surface.getSnapshot)
  const meta=props.sessionMeta(sessionId)
  // The native Sidebar owns fullscreen and keeps the same content mounted.
  // Do not create an overlapping reader or a second fullscreen state here.
  if(props.officialSidebar)return <DetailsPanel key={sessionId} {...props}/>
  return <ReadingFrame expanded={Boolean(state.reading)} target={state.readingTarget}
    toolbar={!props.officialSidebar&&state.reading&&<StudioEntry surface={props.surface} target={meta} placement="reading"/>}
    toggle={()=>props.surface.setReading(!state.reading)}><DetailsPanel key={sessionId} {...props} /></ReadingFrame>
}

function SidebarStudio(props:any) {
  const {tab}=props.useTabInfo()
  const meta=props.sessionMeta(props.sessionId)
  useEffect(()=>{
    props.tabHandles.set(props.sessionId,tab.actions)
    const closed=()=>props.surface.tabClosed(props.sessionId)
    tab.signal.addEventListener('abort',closed,{once:true})
    return ()=>{
      tab.signal.removeEventListener('abort',closed)
      if(props.tabHandles.get(props.sessionId)===tab.actions)props.tabHandles.delete(props.sessionId)
      closed()
    }
  },[props.surface,props.tabHandles,props.sessionId,tab.id,tab.signal])
  useEffect(()=>{
    if(!tab.signal.aborted)props.surface.adoptTab(meta,tab.visible)
  },[props.surface,meta.sessionId,meta.cwd,tab.visible,tab.signal])
  return <SessionDetails {...props} notificationNavigation={tab.navigation} notificationVisible={tab.visible}/>
}

function absoluteWorkspacePath(root: string, relative: string) {
  if (/^[A-Za-z]:[\\/]/.test(relative) || relative.startsWith('/'))
    return relative
  return `${String(root).replace(/[\\/]+$/, '')}/${String(relative).replace(/^[\\/]+/, '')}`
}

export async function apply(ctx: any) {
  const disposeRemote = await ctx.remote.$mount(knowledgeStudioRemote)
  const officialSidebar=typeof ctx.layout.openDetails!=='function'
  ctx.inject(['remote.knowledgeStudio', 'remote.session',...(officialSidebar?['sidebarRight','sidebarRightTabs']:[])], (surfaceCtx: any) => {
    const service = surfaceCtx.remote.knowledgeStudio
    let preferenceWrites=Promise.resolve()
    const tabHandles=new Map<string,any>()
    const layout=officialSidebar?{
      openDetails:()=>surfaceCtx.sidebarRight.openTab('knowledge-studio'),
      closeDetails:()=>tabHandles.get(surface.currentTarget()?.sessionId??'')?.close(),
    }:surfaceCtx.layout
    const canRestoreDetails=(sessionId:string)=>surfaceCtx.sessions.list.getSnapshot().byId[sessionId]?.blank===false
    const surface:KnowledgeSurface = new KnowledgeSurface(layout,sessionId=>officialSidebar||canRestoreDetails(sessionId),open=>{
      if(officialSidebar)return
      preferenceWrites=preferenceWrites.catch(()=>{}).then(async()=>{await unwrap(service.setUIOpenPreference(open))})
      void preferenceWrites.catch(error=>console.error('Could not save Studio preference',error))
    },officialSidebar?()=>false:canRestoreDetails)
    // Native tabs own visibility and session restoration. Legacy preferences
    // must not create a Studio tab when the host starts a new session.
    if(!officialSidebar)void unwrap(service.readUIPreferences()).then((value:any)=>surface.restorePreference(value.open===true)).catch(error=>console.error('Could not load Studio preference',error))
    const sessionMeta = (sessionId: string): Target => {
      const state: any = useSyncExternalStore(surfaceCtx.sessions.list.subscribe, surfaceCtx.sessions.list.getSnapshot, surfaceCtx.sessions.list.getSnapshot)
      return { sessionId, cwd: state.byId[sessionId]?.cwd ?? '' }
    }
    const openFile = async (workspaceRoot: string, path: string) => {
      const result = await surfaceCtx.remote.session.openWorkspacePath({
        path: absoluteWorkspacePath(workspaceRoot, path),
      })
      if (!result?.ok)
        throw new Error(
          result?.error?.message || 'Failed to open workspace file',
        )
    }
    const disposers = [
      ...(!officialSidebar?[
      surfaceCtx.slots.inject('shell.overlay',()=>surfaceCtx.slots.register({name:'shell.overlay',id:'knowledge-studio-reader',order:0,inject:()=>({surface})},ReadingLayer)),
      surfaceCtx.slots.inject('shell.overlay', () =>
        surfaceCtx.slots.register({name:'shell.overlay',id:'knowledge-studio-entry',order:10,
          inject:()=>({surface,sessions:surfaceCtx.sessions})},StudioBlankEntry)),
      surfaceCtx.slots.inject('conversation.session.header.utilities', () =>
        surfaceCtx.slots.register({name:'conversation.session.header.utilities',id:'knowledge-studio-entry',order:30,
          inject:()=>({surface,sessions:surfaceCtx.sessions})},StudioHeaderEntry))]:[]),
      ...(officialSidebar?[
        surfaceCtx.sidebarRightTabs.register({id:'@eduwork/dsh-knowledge-studio',kind:'knowledge-studio',title:()=> 'Studio',guide:[{order:30,title:()=> 'Studio',description:()=>zh?'从工作区资料创建成果':'Create artifacts from workspace sources'}]}),
        surfaceCtx.slots.inject('sidebar.right.pane.tab',()=>surfaceCtx.slots.register({name:'sidebar.right.pane.tab',key:'@eduwork/dsh-knowledge-studio',inject:()=>({surface,service,sessionMeta,openFile,tabHandles,officialSidebar})},SidebarStudio)),
      ]:[surfaceCtx.slots.inject('details', () => {
        let disposeEntry: undefined | (() => void)
        const activation = {
          activate() {
            if (disposeEntry) return
            disposeEntry = surfaceCtx.slots.register(
              {
                name: 'details',
                priority: -50,
                inject: () => ({ surface, service, sessionMeta, openFile }),
              },
              SessionDetails,
            )
          },
          deactivate() {
            disposeEntry?.()
            disposeEntry = undefined
          },
        }
        surface.bind(activation)
        return () => {
          activation.deactivate()
          surface.bind(undefined)
        }
      })]),
    ]
    let syncTimer: number | undefined
    let observedSessionState = ''
    const syncCurrentSession = () => {
      // Closing a native tab on navigation destroys its per-session restore
      // state. SidebarStudio follows the host's tab visibility instead.
      if(officialSidebar)return
      const state = surfaceCtx.sessions.list.getSnapshot()
      const current = state.current
      const summary = current ? state.byId[current] : undefined
      const key = `${current ?? ''}|${summary?.cwd ?? ''}|${summary?.blank ?? ''}`
      if (key === observedSessionState) return
      observedSessionState = key
      if (syncTimer !== undefined) window.clearTimeout(syncTimer)
      // A dismissed destination must not inherit the previous session's reader.
      if(surface.getSnapshot().open&&surface.getSnapshot().sessionId!==current)surface.close()
      if (!current || !summary?.cwd) {
        if (surface.getSnapshot().open || surface.getSnapshot().reading) surface.close()
        return
      }
      syncTimer = window.setTimeout(() => {
        const latest = surfaceCtx.sessions.list.getSnapshot()
        if (
          latest.current === current && latest.byId[current]?.cwd
        )
          surface.enter({ sessionId: current, cwd: latest.byId[current]?.cwd ?? '' })
      }, 16)
    }
    const disposeSessionSync = surfaceCtx.sessions.list.subscribe(
      syncCurrentSession,
    )
    disposers.push(() => {
      disposeSessionSync()
      if (syncTimer !== undefined) window.clearTimeout(syncTimer)
    })
    syncCurrentSession()
    surfaceCtx.effect(
      () => () => {
        if(officialSidebar)surface.tabClosed(surface.getSnapshot().sessionId)
        else surface.close()
        for (const dispose of disposers.reverse()) dispose?.()
      },
      'dsh-knowledge-studio: workspace details surface',
    )
  })
  return async () => {
    await disposeRemote()
  }
}
