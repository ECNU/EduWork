import { defineTool } from '@deepseek-ai/dsh-tools'

function renderJSON(tag, value) {
  return [{ type: 'text', text: `<${tag}>\n${JSON.stringify(value, null, 2)}\n</${tag}>` }]
}

function searchMeta(results) {
  const byPath = new Map()
  for (const result of results) {
    const match = { lineNumber: result.pageStart ?? result.lineStart, line: result.content.split('\n', 1)[0].slice(0, 500) }
    const matches = byPath.get(result.path)
    if (matches) matches.push(match)
    else byPath.set(result.path, [match])
  }
  return { shape: 'matches', files: [...byPath].map(([path, matches]) => ({ path, matches })), truncated: false, total: results.length }
}

function searchViewFromResult(result) {
  if (result.isError || result.meta?.shape !== 'matches' || !Array.isArray(result.meta.files)) return undefined
  return { card: 'search', ...result.meta, title: 'Workspace knowledge search' }
}

export function installKnowledgeStudioTools(ctx, manager, artifacts, {indexedRetrievalTools=false}={}) {
  if (artifacts) ctx.tools.register(defineTool({
    name: 'knowledge_studio_create_artifact',
    description: 'Generate and save a grounded Studio report, mindmap, quiz, flashcards, table, slides, audio or video using current workspace files. Only report success when status is completed. To fix or improve the SAME deliverable in this turn, including a completed file needing edits, pass its returned artifactId as retryArtifactId or reuse its targetKey. Prior versions remain saved and only the final version appears in recent artifacts. Use distinct targetKey values only when the user requests separate deliverables, never for revision numbers or title changes.',
    parameters: {
      kind: { type: 'string', required: true, enum: ['quiz', 'flashcards', 'report', 'mindmap', 'table', 'slides', 'audio', 'video'] },
      retryArtifactId: {type:'string',description:'ArtifactId from this turn to revise the same deliverable, whether its last attempt failed or completed. Keeps prior versions.'},
      targetKey: {type:'string',description:'Stable identity for a user-requested deliverable, unchanged across retries, title/focus changes and completed-file edits. Use different keys only for separate requested outputs, not v1/v2/v3.'},
      count: { type: 'integer' },
      difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
      focus: { type: 'string' },
      pathPrefix: { type:'string',description:'Optional existing INPUT source file or directory relative to the workspace root. Omit or use an empty string to read workspace sources. This is NOT an output destination: saving to Studio does not mean pathPrefix="studio". Never invent a directory.' },
      template: { type:'string' },
      columns: { type:'string' },
      style: { type:'string' },
      delivery: { type:'string',enum:['presentation','reading'] },
      language: { type:'string' },
      audience: { type:'string' },
      narration: { type:'string', enum:['on','off'] },
      subtitles: { type:'string', enum:['on','off'] },
      provider: { type:'string' },
      voice: { type:'string' },
      voiceB: { type:'string' },
      speed: { type:'number' },
      aspect: { type:'string', enum:['16:9','9:16','1:1'] },
      bgm: { type:'string' },
      bgmVolume: { type:'number' },
      sceneSeconds: { type:'number' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        artifactId: { type: 'string', required: true }, status: { type: 'string', required: true },
        message: { type: 'string', required: true },
      } },
      render: (_args, value) => renderJSON('studio_artifact', value),
    },
    async execute(args, exec) {
      const workspace = await manager.workspaceForAgent(exec.agent)
      const artifact = await artifacts.start(workspace, args.kind, args, exec.agent?.session?.id, exec.signal, exec)
      const result = await artifacts.wait(artifact.id)
      const retry=result.lifecycle?.state==='open'?` 本轮继续修正或完善同一成果（包括已生成的文件）时，保留 kind=${result.kind}，传 retryArtifactId="${result.id}" 或沿用原 targetKey；不要给修订版本另起 targetKey。中间版本会保留在历史中，成果区在轮末仅展示最终版本。`:''
      const pptx=result.exports?.find(file=>file.format==='pptx')
      const pages=pptx?.pageCount?` 实际 PPTX 为 ${pptx.pageCount} 页。${pptx.adaptations?.length?'已按可读空间自动换行或续页，保留完整内容。':''}`:''
      const items=result.content?.questions??result.content?.cards
      const count=result.status==='completed'&&items?` 实际生成 ${items.length} ${result.kind==='quiz'?'道题目':'张卡片'}${items.length<result.parameters.count?`（请求 ${result.parameters.count}）`:''}。`:''
      return { artifactId: result.id, status: result.status, message: (result.message || '成果已保存在 Studio 右栏，可答题、翻卡和继续追问。')+pages+count+retry }
    },
    presentCall: args => ({ card: 'generic', title: `Studio · ${args.kind}`, kind: 'read' }),
  }))

  if(!indexedRetrievalTools)return
  ctx.tools.register(defineTool({
    name: 'knowledge_studio_status',
    description: 'Report the optional local knowledge-index status. Studio creation reads source files directly and does not require this index. This never starts indexing.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        indexed: { type: 'boolean', required: true }, statusJSON: { type: 'string', required: true },
      } },
      render: (_args, value) => renderJSON('knowledge_studio_status', JSON.parse(value.statusJSON)),
    },
    async execute(_args, exec) {
      const workspace = await manager.workspaceForAgent(exec.agent)
      const status = await manager.status(workspace)
      return { indexed: status.indexed, statusJSON: JSON.stringify({ ...status, studioRequiresIndex:false, task: manager.task(workspace.id) }) }
    },
    presentCall: () => ({ card: 'generic', title: 'Check workspace knowledge', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'knowledge_studio_search',
    description: 'Search the locally indexed current DSH Workspace. Returns revision-bound Evidence ids, paths, headings, locators, and text. Try several lexical queries when the first wording is too broad.',
    parameters: {
      query: { type: 'string', required: true, description: 'Natural-language, filename, symbol, path, or keyword query.' },
      limit: { type: 'integer', description: 'Maximum results, 1-50; defaults to 10.' },
      path_prefix: { type: 'string', description: 'Optional workspace-relative path prefix.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        results: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
      } },
      render: (_args, value) => renderJSON('knowledge_studio_results', value.results),
      presentationMeta: (_args, value) => searchMeta(value.results),
    },
    async execute(args, exec) {
      const workspace = await manager.workspaceForAgent(exec.agent)
      return { results: await manager.search(workspace, args.query, { limit: args.limit, pathPrefix: args.path_prefix }) }
    },
    presentCall: args => ({ card: 'generic', title: `Search workspace · ${args.query}`, kind: 'search', rawInput: args.query }),
    presentResult: (_args, result) => searchViewFromResult(result),
  }))

  ctx.tools.register(defineTool({
    name: 'knowledge_studio_read',
    description: 'Read one exact indexed chunk returned by knowledge_studio_search.',
    parameters: { chunk_id: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        found: { type: 'boolean', required: true }, chunkJSON: { type: 'string', required: true },
      } },
      render: (_args, value) => renderJSON('knowledge_studio_chunk', JSON.parse(value.chunkJSON)),
    },
    async execute(args, exec) {
      const workspace = await manager.workspaceForAgent(exec.agent)
      const chunk = await manager.readChunk(workspace, args.chunk_id)
      return { found: Boolean(chunk), chunkJSON: JSON.stringify(chunk) }
    },
    presentCall: () => ({ card: 'generic', title: 'Read workspace evidence', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'knowledge_studio_neighbors',
    description: 'Read deterministic context around one indexed chunk: preceding/following chunks and explicitly linked files.',
    parameters: { chunk_id: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        found: { type: 'boolean', required: true }, neighborsJSON: { type: 'string', required: true },
      } },
      render: (_args, value) => renderJSON('knowledge_studio_neighbors', JSON.parse(value.neighborsJSON)),
    },
    async execute(args, exec) {
      const workspace = await manager.workspaceForAgent(exec.agent)
      const neighbors = await manager.neighbors(workspace, args.chunk_id)
      return { found: Boolean(neighbors), neighborsJSON: JSON.stringify(neighbors) }
    },
    presentCall: () => ({ card: 'generic', title: 'Read neighboring evidence', kind: 'read' }),
  }))

}

export const installTools = installKnowledgeStudioTools
