/** Invoke one service-owned tool while preserving DSH policy and settlement. */
export async function executeGovernedTool(ctx, input) {
  // 0.2.1 exposes single-call dispatch. In 0.2.2 tools.execute accepts model
  // batches instead; service subcalls use the public pipeline, retaining the
  // owning agent, cancellation, step admission and opaque parent/root identity.
  if (typeof ctx.tools.setExecutor !== 'function') return ctx.tools.execute(input)
  const { ToolExecutionPipeline } = await import('@deepseek-ai/dsh-tools/pipeline')
  const pipeline = new ToolExecutionPipeline(ctx)
  const prepared = await pipeline.prepare(input)
  const outcome = prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared
  return pipeline.complete(prepared.exec, outcome)
}
