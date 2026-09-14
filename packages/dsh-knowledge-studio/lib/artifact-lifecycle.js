// Session events own turn boundaries; tool completion is only an attempt.
export function executionTurn(execution) {
  const session=execution?.agent?.session
  if(!session?.snapshotEvents)return null
  const events=session.snapshotEvents()
  for(let index=events.length-1;index>=0;index--) {
    const event=events[index]
    if(event.type==='turn/end')return null
    if(event.type==='turn/start')return {sessionId:String(session.id),turn:event.data.turn}
  }
  return null
}
export function presentArtifact(artifact) {
  if(artifact.lifecycle?.state!=='open'||artifact.persistenceError)return artifact
  return {...artifact,attemptStatus:artifact.status,status:'running',
    phase:artifact.status==='running'?artifact.phase:'turn',
    message:artifact.status==='completed'?'成果已生成，等待本轮对话结束':artifact.status==='failed'?'本次尝试未完成，等待本轮修复结果':artifact.message}
}
export function sameArtifactTarget(artifact,kind,parameters) {
  return artifact.kind===kind&&
    (artifact.parameters.pathPrefix||'')===(parameters.pathPrefix||'')
}
export function attemptSnapshot(artifact) {
  const {attempts,lifecycle,...attempt}=artifact
  return {...attempt,callId:lifecycle?.callId||null,finishedAt:artifact.updatedAt}
}

export function settleArtifact(artifact,reason) {
  const endedAt=new Date().toISOString()
  const lifecycle={...artifact.lifecycle,state:'settled',endedAt,reason:reason?.kind||'completed'}
  if(artifact.status!=='completed') {
    const successful=[...(artifact.attempts||[])].reverse().find(attempt=>attempt.status==='completed')
    if(successful) return {...successful,
      id:artifact.id,workspaceId:artifact.workspaceId,sessionId:artifact.sessionId,
      ...(artifact.deletedAt?{deletedAt:artifact.deletedAt}:{}),
      lifecycle,updatedAt:endedAt,
      attempts:[...(artifact.attempts||[]).filter(attempt=>attempt!==successful),attemptSnapshot(artifact)],
      revisionWarning:`最后一次修改未完成，显示第 ${successful.version} 版；修改记录已保留。`,
    }
  }
  return {...artifact,lifecycle,updatedAt:endedAt}
}
