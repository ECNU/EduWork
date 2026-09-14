import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  actionNeedsApproval,
  normalizeOfficeRequest,
  officePresentationMeta,
  presentOfficeCall,
  runOffice,
} from './office.js'

export const name = 'tool-office'
export const inject = ['tools', 'fs', 'permissionPresets']

const definitions = Object.freeze({
  document: Object.freeze({
    name: 'office_document', actions: ['create', 'edit', 'inspect', 'validate'],
    description: 'Create, edit, inspect, or validate a DOCX through the shared Office service.',
    spec: 'Create example: {"blocks":[{"type":"title","text":"Title"},{"type":"paragraph","text":"Body"}]}. Use blocks, not top-level title/paragraphs. Edit example: {"operations":[{"op":"replace_text","find":"Old","replace":"New"}]}. Rich formatting: artifact-documents skill.',
  }),
  spreadsheet: Object.freeze({
    name: 'office_spreadsheet', actions: ['create', 'edit', 'inspect', 'validate'],
    description: 'Create, edit, inspect, or validate an XLSX through the shared Office service.',
    spec: 'Create example: {"sheets":[{"name":"Data","rows":[["Name","Value"],["Example",1]],"header":true}]}. Cells may be scalars or {"type":"text","value":"=literal"} / {"type":"formula","value":"=SUM(B2:B3)"}. Edit example: {"operations":[{"op":"set","sheet":"Data","cell":"B2","value":2}]}. See artifact-spreadsheets skill.',
  }),
  presentation: Object.freeze({
    name: 'office_presentation', actions: ['create', 'inspect', 'validate'],
    description: 'Create, inspect, or validate a themed PPTX through the shared Office service.',
    spec: 'Create example: {"theme":"modern-clean","slides":[{"layout":"summary","title":"Title","bullets":["One point"],"speaker_notes":"Full notes"}]}. Advanced layouts/themes: artifact-presentations skill. External decks need no brand markers.',
  }),
  pdf: Object.freeze({
    name: 'office_pdf', actions: ['create', 'inspect', 'merge', 'extract', 'validate'],
    description: 'Create, inspect, merge, extract pages from, or validate a PDF through the shared Office service.',
    spec: 'Create example: {"title":"Title","blocks":[{"type":"paragraph","text":"Body"}]}. See artifact-pdfs skill for tables and formatting; merge/extract do not use spec_json.',
  }),
})

function requireWorkspace(exec) {
  const cwd = exec.agent?.session.header.cwd
  if (typeof cwd !== 'string' || cwd.trim().length === 0) throw new Error('office tools require a session workspace')
  return cwd
}

function tool(format, definition, ctx) {
  return defineTool({
    name: definition.name,
    description: `${definition.description} Creates workspace files; it does not register Studio artifacts. If the host provides present, call it for the verified final output before the final response. If the user requests a Studio artifact, use knowledge_studio_create_artifact instead. Supply project-relative paths; never construct shell commands for this operation.`,
    parameters: {
      action: { type: 'string', required: true, enum: definition.actions, description: 'Deterministic office operation.' },
      input_path: { type: 'string', description: 'One project-relative input file, when required.' },
      output_path: { type: 'string', description: 'One new project-relative output file, when required. Existing files are not overwritten.' },
      spec: { type:'object',additionalProperties:true,description:`Preferred: direct object describing create/edit content, without JSON string escaping. ${definition.spec}` },
      spec_json: { type: 'string', description: 'Legacy alternative to spec: JSON object encoded once as a string. Supply only one of spec and spec_json.' },
      input_paths_json: { type: 'string', description: 'PDF merge only: JSON array of 2–50 project-relative PDF paths in merge order.' },
      pages: { type: 'string', description: 'PDF extract only: 1-based page expression such as 1,3-5 or all.' },
      strict: { type: 'boolean', description: 'Presentation validation only; reserve strict mode for template regression, not ordinary user work.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          format: { type: 'string', required: true }, action: { type: 'string', required: true },
          reportJSON: { type: 'string', required: true }, relativePath: { type: 'string' }, mime: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `<office_format>${value.format}</office_format>\n<office_action>${value.action}</office_action>${value.relativePath ? `\n<artifact>${value.relativePath}</artifact>` : ''}\n<report>\n${value.reportJSON}\n</report>` }],
      presentationMeta: (_args, value) => officePresentationMeta(value),
    },
    timeoutMs: 190_000,
    async execute(args, exec) {
      const request = normalizeOfficeRequest(format, args)
      const cwd = requireWorkspace(exec)
      const root = await ctx.fs.resolve('.', { cwd, signal: exec.signal })
      const info = await ctx.fs.stat(root, exec.signal)
      if (info?.type !== 'directory') throw new Error('the session workspace is unavailable')
      const result = await runOffice({ request, projectPath: ctx.fs.processPath(root), signal: exec.signal })
      return {
        format, action: request.action, reportJSON: JSON.stringify(result.report),
        ...(result.invocation.artifact === undefined ? {} : { relativePath: result.invocation.artifact, mime: result.invocation.mime }),
      }
    },
    presentCall: args => presentOfficeCall(format, definition.name, args),
    presentResult: (_args, result) => result.isError ? undefined : ({ card: 'generic', title: `${format} operation completed` }),
  })
}

export function apply(ctx) {
  const byName = new Map(Object.entries(definitions).map(([format, definition]) => [definition.name, format]))
  ctx.on('tools/pre-execute', (exec, next) => {
    const format = byName.get(exec.name)
    if (format === undefined || !actionNeedsApproval(format, exec.arguments ?? {})) return next()
    const agent = exec.agent
    if (agent === undefined) return Promise.resolve({ kind: 'deny', reason: 'office writes require an Agent-backed session' })
    if (ctx.permissionPresets.current(agent.session) === 'danger-full-access') return next()
    return Promise.resolve({ kind: 'ask', reason: `Create or modify a ${format} artifact in the current workspace` })
  })
  for (const [format, definition] of Object.entries(definitions)) ctx.tools.register(tool(format, definition, ctx))
}
