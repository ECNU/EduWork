import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, lstat, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { parseDocument } from '../lib/parser.js'
import { KnowledgeIndexManager } from '../lib/manager.js'
import { WorkspaceKnowledgeStore } from '../lib/store.js'
import { installKnowledgeStudioSkill } from '../lib/skill.js'
import { tokenize } from '../lib/tokenizer.js'
import { basicEvidence } from '../lib/basic-evidence.js'
import { ArtifactEngine } from '../lib/artifacts.js'

test('tokenizer handles Chinese characters, bigrams, and code identifiers deterministically', () => {
  assert.deepEqual(tokenize('注意力 Transformer_V2'), ['注', '意', '力', '注意', '意力', 'transformer_v2', 'transformer', 'v2'])
})

test('bundled Skill registers through the official DSH skill seam', () => {
  let registered
  const dispose = () => {}
  const result = installKnowledgeStudioSkill({ skills: { register(skill) { registered = skill; return dispose } } })
  assert.equal(result, dispose)
  assert.equal(registered.name, 'knowledge-studio')
  assert.equal(registered.source, 'bundled')
  assert.equal(registered.invocation.modelInvocable, true)
  assert.match(registered.whenToUse, /Studio/)
  assert.doesNotMatch(registered.description+' '+registered.whenToUse, /workspace knowledge|Search the current|Wiki/)
  assert.match(registered.content, /knowledge_studio_create_artifact/)
  assert.doesNotMatch(registered.content, /knowledge_studio_search|Wiki|知识准备/)
  assert.doesNotMatch(registered.content, /^---/)
})

test('parser derives sections, chunks, line ranges, and local links', () => {
  const parsed = parseDocument({
    path: 'notes/research.md',
    text: '# 研究目标\n\n研究注意力机制。\n\n## 实验\n\n见 [代码](../src/experiment.py)。',
    maxChunkChars: 100,
  })
  assert.deepEqual(parsed.links, ['src/experiment.py'])
  assert.equal(parsed.sections.length, 2)
  assert.equal(parsed.sections[0].title, '研究目标')
  assert.equal(parsed.sections[1].chunks[0].lineStart, 6)
})

test('store incrementally indexes, searches, relates, deletes, and reopens', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-knowledge-studio-core-'))
  const databasePath = join(root, 'index.lbug')
  const workspace = { id: 'ws-test', title: '测试工作区', rootPath: 'C:/workspace/test' }
  const initial = [
    {
      path: 'research.md',
      version: 'v1',
      text: '# 研究目标\n\n研究 Transformer 注意力机制。\n\n## 实验\n\n实验代码见 [experiment.py](src/experiment.py)。',
    },
    {
      path: 'src/experiment.py',
      version: 'v1',
      text: 'def attention_score(query, key):\n    return query * key\n',
    },
  ]

  let store = new WorkspaceKnowledgeStore(databasePath)
  try {
    const firstSync = await store.syncDocuments(workspace, initial)
    assert.ok(!Number.isNaN(Date.parse(firstSync.indexedAt)))
    assert.deepEqual({ ...firstSync, indexedAt: 'ignored' }, {
      added: 2,
      changed: 0,
      unchanged: 0,
      removed: 0,
      indexedAt: 'ignored',
    })
    const unchanged = await store.syncDocuments(workspace, initial)
    assert.deepEqual({ ...unchanged, indexedAt: 'ignored' }, {
      added: 0,
      changed: 0,
      unchanged: 2,
      removed: 0,
      indexedAt: 'ignored',
    })

    const results = await store.search('注意力', { limit: 5 })
    assert.equal(results[0].path, 'research.md')
    assert.equal(results[0].lineStart, 2)
    assert.ok(results[0].score > 0)

    const related = await store.neighbors(results[0].id)
    assert.deepEqual(related.linkedFiles, [{ path: 'src/experiment.py', kind: 'py' }])
    assert.equal(related.next[0].heading, '实验')

    const changedDocuments = [
      { ...initial[0], version: 'v2', text: initial[0].text.replace('注意力机制', '稀疏注意力机制') },
    ]
    const changed = await store.syncDocuments(workspace, changedDocuments)
    assert.deepEqual({ ...changed, indexedAt: 'ignored' }, {
      added: 0,
      changed: 1,
      unchanged: 0,
      removed: 1,
      indexedAt: 'ignored',
    })
    assert.equal((await store.search('attention_score')).length, 0)
    assert.equal((await store.search('稀疏注意力'))[0].path, 'research.md')

    const status = await store.status()
    assert.equal(status.files, 1)
    assert.equal(status.chunks, 2)
  } finally {
    await store.close()
  }

  store = new WorkspaceKnowledgeStore(databasePath)
  try {
    const status = await store.status()
    assert.equal(status.files, 1)
    assert.equal(status.workspace.workspaceId, 'ws-test')
    assert.equal((await store.search('稀疏注意力'))[0].path, 'research.md')
  } finally {
    await store.close()
    await rm(root, { recursive: true, force: true })
  }
})

class TestFileSystem {
  textReads = 0
  async resolve(path, options = {}) {
    const absolute = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path)
    const canonical = await realpath(absolute)
    return { targetKey: canonical, displayPath: canonical }
  }

  processPath(target) { return target.targetKey }

  contains(parent, child) {
    const value = relative(parent.targetKey, child.targetKey)
    return value === '' || (value !== '..' && !value.startsWith(`..${requireSeparator()}`) && !isAbsolute(value))
  }

  async stat(target) {
    try {
      const info = await stat(target.targetKey, { bigint: true })
      return {
        type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
        size: info.isFile() ? Number(info.size) : undefined,
        version: `${info.size}:${info.mtimeNs}`,
      }
    } catch (error) {
      if (error.code === 'ENOENT') return undefined
      throw error
    }
  }

  async lstat(path, options = {}) {
    try {
      const info = await lstat(resolve(options.cwd ?? process.cwd(), path), { bigint: true })
      return {
        type: info.isSymbolicLink() ? 'symlink' : info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
        size: info.isFile() ? Number(info.size) : undefined,
        version: `${info.size}:${info.mtimeNs}`,
      }
    } catch (error) {
      if (error.code === 'ENOENT') return undefined
      throw error
    }
  }

  async readText(target) { this.textReads += 1; return readFile(target.targetKey, 'utf8') }

  async readBytes(target, _signal, maxBytes) {
    const bytes = await readFile(target.targetKey)
    if (bytes.byteLength > maxBytes) throw new Error(`file exceeds ${maxBytes} bytes`)
    return new Uint8Array(bytes)
  }

  async listDir(target) {
    const entries = await readdir(target.targetKey, { withFileTypes: true })
    return Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(async entry => {
      const child = await this.resolve(join(target.targetKey, entry.name))
      const info = await this.stat(child)
      return { name: entry.name, type: info.type, target: child, version: info.version, size: info.size }
    }))
  }
}

function requireSeparator() {
  return process.platform === 'win32' ? '\\' : '/'
}

test('unprepared workspace generates a quiz from attachments while ignoring runtimes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-basic-'))
  const workspaceRoot = join(root, 'workspace')
  for (const directory of ['.chatecnu/attachments', '.chatecnu/environments/python/runtime/Lib', '.cache', 'notes', '.artifacts/media', '.ecnu-agent/video-projects']) {
    await mkdir(join(workspaceRoot, directory), { recursive: true })
  }
  await writeFile(join(workspaceRoot, '.chatecnu/environments/python/runtime/Lib/ignore.py'), 'unrelated runtime')
  await writeFile(join(workspaceRoot, '.artifacts/media/generated.md'), '数据治理：生成结果不能成为自己的来源。')
  await writeFile(join(workspaceRoot, '.ecnu-agent/video-projects/generated.md'), '数据治理：渲染工程不是资料依据。')
  await writeFile(join(workspaceRoot, '.chatecnu/attachments/policy.md'), '# 数据治理\n\n数据分类要求统一口径。数据责任人负责质量。数据使用应遵守权限。')
  const workspace = { id: 'basic', title: 'Basic', path: workspaceRoot }
  const fs = new TestFileSystem()
  const manager = new KnowledgeIndexManager({ fs }, { dataRoot: join(root, 'data') })
  const evidence = await basicEvidence(fs, workspace, '数据治理')
  assert.equal(evidence.length, 1)
  assert.equal(evidence[0].path, '.chatecnu/attachments/policy.md')
  const ctx = { fs, workspaceRegistry: { get: () => workspace }, agents: { get: () => null },
    agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test' }) },
    llm: { stream: async function* () {
      yield { type: 'text-delta', index: 0, text: JSON.stringify({ title: '数据治理', questions: Array.from({ length: 5 }, (_, i) => ({
        question: `问题 ${i}`, options: ['统一口径', '任意口径'], correctIndex: 0,
        explanation: '资料要求统一口径', evidenceIds: ['S1'],
      })) }) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } },
  }
  const engine = new ArtifactEngine(ctx, manager, { artifactPath: join(root, 'artifacts.json') })
  try {
    const started = await engine.start(workspace, 'quiz', { count: 5 }, 'session-basic')
    const result = await engine.wait(started.id)
    assert.equal(result.status, 'completed', result.message)
    assert.equal(result.sessionId, 'session-basic')
    assert.equal(result.sourceMode, 'files')
    assert.equal(result.citations.length, 1)
    assert.equal(result.citations[0].fresh, true)
    assert.equal(existsSync(manager.databasePath(workspace.id)), false)
    assert.equal(existsSync(join(root, 'data', workspace.id, 'consent.json')), false)
    await engine.interaction(result.id, 'answer', 'q1', 1)
    assert.match(await engine.askPrompt(result.id, 'q1'), /我的选择：B/)
    await writeFile(join(workspaceRoot, '.chatecnu/attachments/policy.md'), 'source changed')
    assert.equal((await engine.read(result.id)).citations[0].fresh, false)
  } finally { await engine.close(); await manager.close() }
})

test('manager stays idle until explicit indexing and then applies filesystem deltas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-knowledge-studio-manager-'))
  const workspaceRoot = join(root, 'workspace')
  const dataRoot = join(root, 'data')
  await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
  await mkdir(join(workspaceRoot, 'node_modules'), { recursive: true })
  await writeFile(join(workspaceRoot, 'notes', 'one.md'), '# 知识图谱\n\nLadybugDB 嵌入式索引。', 'utf8')
  await writeFile(join(workspaceRoot, 'notes', 'ignored.bin'), Buffer.from([0, 1, 2]))
  await writeFile(join(workspaceRoot, 'package-lock.json'), '{"packages":{"generated":"lock metadata"}}', 'utf8')
  await writeFile(join(workspaceRoot, 'node_modules', 'ignored.md'), '# 不应扫描', 'utf8')

  const workspace = { id: 'ws-manager', title: '管理器测试', path: await realpath(workspaceRoot) }
  const fileSystem = new TestFileSystem()
  const manager = new KnowledgeIndexManager({ fs: fileSystem }, { dataRoot })
  try {
    const before = await manager.status(workspace)
    assert.equal(before.indexed, false)
    assert.equal(existsSync(before.databasePath), false)

    const first = await manager.indexWorkspace(workspace)
    assert.equal(first.discovered, 1)
    assert.equal(first.added, 1)
    assert.equal(first.skipped.unsupported, 2)
    assert.equal((await manager.search(workspace, '嵌入式索引'))[0].path, 'notes/one.md')
    assert.equal(fileSystem.textReads, 1)

    await writeFile(join(workspaceRoot, 'notes', 'one.md'), '# 知识图谱\n\nLadybugDB 本地优先索引。', 'utf8')
    await writeFile(join(workspaceRoot, 'notes', 'two.txt'), '新增文档', 'utf8')
    const second = await manager.indexWorkspace(workspace)
    assert.equal(second.changed, 1)
    assert.equal(second.added, 1)
    assert.equal(fileSystem.textReads, 3)

    await unlink(join(workspaceRoot, 'notes', 'two.txt'))
    const third = await manager.indexWorkspace(workspace)
    assert.equal(third.unchanged, 1)
    assert.equal(third.removed, 1)
    assert.equal(fileSystem.textReads, 3, 'unchanged files must not be read or parsed again')
  } finally {
    await manager.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('workspace indexing exposes progress, completes in background, and can be cancelled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-knowledge-studio-task-'))
  const workspaceRoot = join(root, 'workspace')
  const dataRoot = join(root, 'data')
  await mkdir(workspaceRoot, { recursive: true })
  await writeFile(join(workspaceRoot, 'one.md'), '# 后台任务\n\n确定性结构图。', 'utf8')

  const workspace = { id: 'ws-task', title: '任务测试', path: await realpath(workspaceRoot) }
  const manager = new KnowledgeIndexManager({ fs: new TestFileSystem() }, { dataRoot })
  try {
    const started = manager.startIndex(workspace)
    assert.equal(started.status, 'running')
    assert.equal(started.phase, 'scan')
    const completed = await manager.waitForIndex(workspace.id)
    assert.equal(completed.status, 'completed')
    assert.equal(completed.phase, 'done')
    assert.equal(completed.processed, 1)
    assert.equal(completed.result.added, 1)
    assert.equal(completed.result.skipped.unreadable, 0)
    assert.equal((await manager.status(workspace)).files, 1)

    const restarted = manager.startIndex(workspace)
    assert.equal(restarted.status, 'running')
    const stopping = manager.cancelIndex(workspace.id)
    assert.ok(['stopping', 'killed'].includes(stopping.status))
    const cancelled = await manager.waitForIndex(workspace.id)
    assert.equal(cancelled.status, 'killed')
    assert.match(cancelled.message, /cancel/i)
  } finally {
    await manager.close()
    await rm(root, { recursive: true, force: true })
  }
})

function simplePdf(text) {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
  const content = `BT /F1 16 Tf 72 720 Td (${escaped}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'ascii')
}

test('PDF text is indexed with a citeable page locator', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-knowledge-studio-pdf-'))
  const workspaceRoot = join(root, 'workspace')
  const dataRoot = join(root, 'data')
  await mkdir(workspaceRoot, { recursive: true })
  await writeFile(join(workspaceRoot, 'paper.pdf'), simplePdf('Deterministic graph indexing for research papers'))

  const workspace = { id: 'ws-pdf', title: 'PDF 测试', path: await realpath(workspaceRoot) }
  const manager = new KnowledgeIndexManager({ fs: new TestFileSystem() }, { dataRoot })
  try {
    const indexed = await manager.indexWorkspace(workspace)
    assert.equal(indexed.added, 1)
    assert.equal(indexed.discovered, 1)
    const [result] = await manager.search(workspace, 'deterministic graph')
    assert.equal(result.path, 'paper.pdf')
    assert.equal(result.locator, 'page')
    assert.equal(result.pageStart, 1)
    assert.equal(result.pageEnd, 1)
    const chunk = await manager.readChunk(workspace, result.id)
    assert.equal(chunk.pageStart, 1)
    assert.match(chunk.content, /research papers/i)
  } finally {
    await manager.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('Typert-facing methods use plain identifier parameters', async () => {
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(source, /async readEvidence\(workspaceId, evidenceId\)/)
  assert.match(source, /async exportArtifact\(artifactId, format\)/)
  assert.doesNotMatch(source, /async (?:readEvidence|exportArtifact)\([^)]*=/)
})
