import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ArtifactEngine, ArtifactStore, normalizeParameters, validateFlashcards, validateQuiz } from '../lib/artifacts.js'

const evidence = [
  { evidenceId: 'e1', path: 'README.md', heading: '目标', content: '工作区知识使用本地索引。', locator: 'line', lineStart: 1, lineEnd: 3 },
  { evidenceId: 'e2', path: 'docs/design.md', heading: '交互', content: '测验保存作答状态。', locator: 'line', lineStart: 8, lineEnd: 10 },
]

test('an empty explicit source scope explains how to repair the same artifact before model generation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'studio-empty-scope-'))
  let calls=0
  const engine=new ArtifactEngine({workspaceRegistry:{get:()=>null},llm:{stream:async function*(){calls++;throw new Error('must not generate')}}},{status:async()=>({indexed:true}),searchDetailed:async()=>({results:[]})},{artifactPath:join(root,'artifacts.json')})
  try {
    const created=await engine.start({id:'source-scope',title:'Scope'},'report',{pathPrefix:'studio'},'scope-session')
    const result=await engine.wait(created.id)
    assert.equal(result.status,'failed')
    assert.match(result.message,/输入资料范围 "studio"/)
    assert.match(result.message,/不是 Studio 输出位置/)
    assert.match(result.message,/同一 artifactId/)
    assert.match(result.message,/无需先建立索引/)
    assert.equal(calls,0)
  } finally {await engine.close();await rm(root,{recursive:true,force:true})}
})

test('concurrent first reads do not overwrite newly created artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-artifact-load-'))
  const path = join(root, 'artifacts.json')
  const store = new ArtifactStore(path)
  const workspace = { id: 'race', title: 'Race' }
  const created = store.create(workspace, 'quiz', { count: 5 })
  await Promise.all([created, ...Array.from({ length: 20 }, () => store.list(workspace.id))])
  const result = await created
  assert.equal((await store.list(workspace.id)).length, 1)
  assert.equal((await new ArtifactStore(path).read(result.id)).id, result.id)
})

test('interactive artifact validators reject invented citations', () => {
  const quiz = validateQuiz(JSON.stringify({ title: '测试', questions: [
    { question: '索引在哪里完成？', options: ['本机', '远端'], correctIndex: 0, explanation: '资料明确说明。', evidenceIds: ['e1'] },
    { question: '什么状态会保存？', options: ['作答', '窗口'], correctIndex: 0, explanation: '保存作答。', evidenceIds: ['e2'] },
    { question: '哪项正确？', options: ['本地索引', '远程向量'], correctIndex: 0, explanation: '本地索引。', evidenceIds: ['e1', 'invented'] },
  ] }), evidence, 3)
  assert.equal(quiz.questions.length, 3)
  assert.deepEqual(quiz.questions[2].evidenceIds, ['e1'])

  const cards = validateFlashcards(JSON.stringify({ cards: [
    { front: '索引位置？', back: '本机。', evidenceIds: ['e1'] },
    { front: '保存什么？', back: '作答状态。', evidenceIds: ['e2'] },
    { front: '证据？', back: '真实引用。', evidenceIds: ['e1'] },
    { front: '边界？', back: '工作区。', evidenceIds: ['e2'] },
  ] }), evidence, 4)
  assert.equal(cards.cards.length, 4)
})

test('artifact store persists quiz progress and restores it after reopening', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-knowledge-studio-artifact-'))
  const path = join(root, 'artifacts.json')
  try {
    const store = new ArtifactStore(path)
    const created = await store.create({ id: 'workspace-1', title: '演示' }, 'quiz', normalizeParameters('quiz', { count: 5, difficulty: 'hard' }))
    await store.update(created.id, {
      status: 'completed', phase: 'done', content: { title: '测验', questions: [{ id: 'q1', question: '问题', options: ['A', 'B'], correctIndex: 1, explanation: '解释', evidenceIds: ['e1'] }] },
      citations: evidence.slice(0, 1), interaction: { current: 0, answers: {}, revealed: {} },
    })
    await store.interaction(created.id, 'answer', 'q1', 1)
    await store.interaction(created.id, 'reveal', 'q1', true)
    const reopened = new ArtifactStore(path)
    const artifact = await reopened.read(created.id)
    assert.equal(artifact.interaction.answers.q1, 1)
    assert.equal(artifact.interaction.revealed.q1, true)
    assert.equal((await reopened.list('workspace-1'))[0].content, undefined)
    assert.doesNotReject(() => readFile(path, 'utf8'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('artifact engine generates a grounded quiz through the current DSH model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-knowledge-studio-engine-'))
  const workspace = { id: 'workspace-engine', title: '演示项目' }
  const generated = JSON.stringify({ title: '本地知识测验', questions: [
    { question: '问题一？', options: ['本机', '远端'], correctIndex: 0, explanation: '解释一', evidenceIds: ['S1'] },
    { question: '问题二？', options: ['保存', '丢弃'], correctIndex: 0, explanation: '解释二', evidenceIds: ['S2'] },
    { question: '问题三？', options: ['工作区', '笔记本'], correctIndex: 0, explanation: '解释三', evidenceIds: ['S1'] },
    { question: '问题四？', options: ['作答状态', '窗口'], correctIndex: 0, explanation: '解释四', evidenceIds: ['S2'] },
    { question: '问题五？', options: ['真实引用', '编造引用'], correctIndex: 0, explanation: '解释五', evidenceIds: ['S1'] },
  ] })
  const byId = new Map(evidence.map(item => [item.evidenceId, { ...item, chunkId: `chunk-${item.evidenceId}`, excerptHash: `excerpt-${item.evidenceId}`, revisionHash: `revision-${item.evidenceId}` }]))
  const manager = {
    searchDetailed: async () => ({ results: [...byId.values()] }),
    sample: async () => [...byId.values()],
    readEvidence: async (_workspace, id) => byId.get(id) ?? null,
  }
  const ctx = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test' }) },
    agents: { get: () => null },
    workspaceRegistry: { get: id => id === workspace.id ? workspace : null },
    llm: { stream: async function* () { yield { type: 'text-delta', index: 0, text: generated }; yield { type: 'finish', reason: { kind: 'stop' } } } },
  }
  try {
    const engine = new ArtifactEngine(ctx, manager, { artifactPath: join(root, 'artifacts.json') })
    const started = await engine.start(workspace, 'quiz', { count: 5 }, 'session-1')
    const artifact = await engine.wait(started.id)
    assert.equal(artifact.status, 'completed')
    assert.equal(artifact.content.questions.length, 5)
    assert.equal(artifact.citations.every(item => item.fresh), true)
    await engine.close()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
