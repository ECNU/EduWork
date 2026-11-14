import type { Context } from '@deepseek-ai/cordis'
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'

/** Run one service call through the real pipeline, rather than the model batch executor. */
export async function executeTool(ctx: Context, input: Parameters<ToolExecutionPipeline['prepare']>[0]) {
  const pipeline = new ToolExecutionPipeline(ctx)
  const prepared = await pipeline.prepare(input)
  const outcome = prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared
  return pipeline.complete(prepared.exec, outcome)
}
