import { defineTool } from '@deepseek-ai/dsh-tools'
import { artifactMediaType, normalizeArtifactRelativePath, presentArtifactCall } from './core.js'

export const name = 'tool-artifact-publish'
export const inject = ['tools', 'fs']

function workspace(exec) {
  const cwd = exec.agent?.session.header.cwd
  if (typeof cwd !== 'string' || cwd.trim().length === 0) throw new Error('artifact_publish requires a session workspace')
  return cwd
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'artifact_publish',
    description: 'Publish one existing project-relative generated file into the conversation so the user can preview and open it. Use after shell-based renderers such as Remotion finish successfully. This tool is read-only.',
    parameters: {
      relative_path: { type: 'string', required: true, description: 'Existing project-relative artifact path.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, properties: {
          relativePath: { type: 'string', required: true }, mime: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `<artifact>${value.relativePath}</artifact>\nPublished ${value.mime} artifact (${value.bytes} bytes).` }],
      presentationMeta: (_args, value) => ({ relativePath: value.relativePath, mime: value.mime, bytes: value.bytes }),
    },
    timeoutMs: 15_000,
    async execute(args, exec) {
      const relativePath = normalizeArtifactRelativePath(args.relative_path)
      const cwd = workspace(exec)
      const root = await ctx.fs.resolve('.', { cwd, signal: exec.signal })
      const target = await ctx.fs.resolve(relativePath, { cwd, signal: exec.signal })
      if (!ctx.fs.contains(root, target)) throw new Error('artifact must stay inside the current workspace')
      const info = await ctx.fs.stat(target, exec.signal)
      if (info?.type !== 'file' || !Number.isSafeInteger(Number(info.size)) || Number(info.size) <= 0) throw new Error('artifact is not a non-empty regular file')
      return { relativePath, mime: artifactMediaType(target.displayPath), bytes: Number(info.size) }
    },
    presentCall: presentArtifactCall,
    presentResult: (_args, result) => result.isError ? undefined : ({ card: 'generic', title: 'Artifact ready' }),
  }))
}
