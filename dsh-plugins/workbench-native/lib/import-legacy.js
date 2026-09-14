// DSH descriptor v2 (0.1.2-rc.7) -> v3 only adds the optional
// agentReasoningEffort field. Preserve the old composition verbatim. The
// official v0 codec only accepts v3, so normalize this known historical case
// before its strict validation. Unknown versions/fields are never guessed.
export function normalizeLegacyImportRow(row, storedVersion) {
  if (storedVersion !== 0 || row?.type !== 'subagent/descriptor' || row.data?.version !== 2) return row
  const data = row.data
  const keys = ['version', 'mode', 'provider', 'label']
  if (data.mode === 'continuable') keys.push('agentProvider', 'agentModel', 'persona', 'toolFilter')
  const unknown = Object.keys(data).find(key => !keys.includes(key))
  if (unknown) throw Error(`旧子代理描述 v2 含未知字段 ${unknown}，未进行转换`)
  // Payload values, event coordinates and relationships are still validated
  // by the official current format catalog after this lossless schema change.
  return { ...row, data: { ...data, version: 3 } }
}
