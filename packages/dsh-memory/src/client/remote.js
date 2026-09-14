import { z } from 'zod'

const pkg = '@eduwork/dsh-memory'
const source = { file: 'src/host/index.js', line: 1, column: 1 }
const byKind = z.object({
  fact: z.number().int().nonnegative(), preference: z.number().int().nonnegative(),
  decision: z.number().int().nonnegative(), lesson: z.number().int().nonnegative(),
  todo: z.number().int().nonnegative(), note: z.number().int().nonnegative(),
}).strict()
const stats = z.object({ total: z.number().int().nonnegative(), suppressed: z.number().int().nonnegative(), byKind }).strict()
const nullableText = z.string().nullable()
const memorySource = z.object({
  kind: z.enum(['session', 'web', 'file', 'email', 'tool', 'manual', 'other']),
  uri: nullableText, label: nullableText, sessionId: nullableText, messageId: nullableText,
  eventSeq: z.number().int().nonnegative().nullable(), toolName: nullableText, callId: nullableText,
  capturedAt: z.string(),
}).strict()
const record = z.object({
  id: z.string(), content: z.string(), kind: z.enum(['fact', 'preference', 'decision', 'lesson', 'todo', 'note']),
  tags: z.array(z.string()), scope: z.enum(['user', 'project']), project: nullableText,
  importance: z.number().int().min(1).max(3), sources: z.array(memorySource),
  origin: z.enum(['automatic', 'explicit-user-request']), authority: z.enum(['automatic', 'user']).optional(),
  userEditedAt: nullableText.optional(), userPinnedAt: nullableText.optional(), previousContent: nullableText.optional(), revision: z.number().int().positive().optional(),
  createdAt: z.string(), updatedAt: z.string(), accessedAt: nullableText, accessCount: z.number().int().nonnegative(),
}).strict()
const result = (typeSymbol, schema) => ({ mode: 'strict', typeSymbol, schema })
const parameter = (name, max, typeSymbol) => ({
  name, wire: name, source: 'json', codec: result(typeSymbol, z.string().max(max)),
})
const descriptor = (method, parameters, schema) => ({
  id: `${pkg}#localMemories/${method}`, service: 'localMemories', namespace: 'localMemories', method,
  invocation: { kind: 'direct' }, parameters, result: schema, sourceLocation: source,
})

export default {
  package: pkg,
  descriptors: [
    descriptor('stats', [], result(`${pkg}#MemoryStats`, stats)),
    descriptor('listRecords', [parameter('request', 8_192, `${pkg}#MemoryListRequest`)], result(`${pkg}#MemoryList`, z.object({
      total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), limit: z.number().int().min(1).max(50), items: z.array(record).max(50),
    }).strict())),
    descriptor('updateRecord', [parameter('request', 8_192, `${pkg}#MemoryUpdateRequest`)], result(`${pkg}#MemoryUpdate`, z.object({
      updated: z.boolean(), record,
    }).strict())),
    descriptor('setRecordPinned', [parameter('request', 8_192, `${pkg}#MemoryRetentionRequest`)], result(`${pkg}#MemoryUpdate`, z.object({
      updated: z.boolean(), record,
    }).strict())),
    descriptor('undoRecordUpdate', [parameter('id', 256, `${pkg}#MemoryId`)], result(`${pkg}#MemoryUpdate`, z.object({
      updated: z.boolean(), record,
    }).strict())),
    descriptor('deleteRecord', [parameter('request', 8_192, `${pkg}#MemoryDeleteRequest`)], result(`${pkg}#MemorySingleDelete`, z.object({
      id: z.string(), deleted: z.boolean(), mode: z.enum(['delete', 'forget']), undoToken: nullableText, suppressionCreated: z.boolean(),
    }).strict())),
    descriptor('undoDelete', [parameter('token', 128, `${pkg}#MemoryUndoToken`)], result(`${pkg}#MemoryUndoDelete`, z.object({
      id: z.string(), restored: z.boolean(), record,
    }).strict())),
    descriptor('deleteAll', [parameter('confirmation', 64, `${pkg}#DeleteConfirmation`)], result(`${pkg}#MemoryDeleteResult`, stats.extend({ deleted: z.number().int().nonnegative() }).strict())),
    descriptor('exportData', [], result(`${pkg}#MemoryExport`, z.string().max(8_000_000))),
    descriptor('importData', [parameter('document', 8_000_000, `${pkg}#MemoryImportDocument`)], result(`${pkg}#MemoryImportResult`, stats.extend({
      imported: z.number().int().nonnegative(), merged: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(),
    }).strict())),
  ],
}
