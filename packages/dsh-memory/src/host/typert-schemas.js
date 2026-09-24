import { z } from 'zod'

const byKindSchema = z.object({
  fact: z.number().int().nonnegative(),
  preference: z.number().int().nonnegative(),
  decision: z.number().int().nonnegative(),
  lesson: z.number().int().nonnegative(),
  todo: z.number().int().nonnegative(),
  note: z.number().int().nonnegative(),
}).strict()

const statsSchema = z.object({
  total: z.number().int().nonnegative(),
  suppressed: z.number().int().nonnegative(),
  byKind: byKindSchema,
}).strict()

const nullableText = z.string().nullable()
const sourceSchema = z.object({
  kind: z.enum(['session', 'web', 'file', 'email', 'tool', 'manual', 'other']),
  uri: nullableText,
  label: nullableText,
  sessionId: nullableText,
  messageId: nullableText,
  eventSeq: z.number().int().nonnegative().nullable(),
  toolName: nullableText,
  callId: nullableText,
  capturedAt: z.string(),
}).strict()
const recordSchema = z.object({
  id: z.string(),
  content: z.string(),
  kind: z.enum(['fact', 'preference', 'decision', 'lesson', 'todo', 'note']),
  tags: z.array(z.string()),
  scope: z.enum(['user', 'project']),
  project: nullableText,
  importance: z.number().int().min(1).max(3),
  sources: z.array(sourceSchema),
  origin: z.enum(['automatic', 'explicit-user-request']),
  authority: z.enum(['automatic', 'user']).optional(),
  userEditedAt: nullableText.optional(),
  userPinnedAt: nullableText.optional(),
  previousContent: nullableText.optional(),
  revision: z.number().int().positive().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  accessedAt: nullableText,
  accessCount: z.number().int().nonnegative(),
}).strict()

const listSchema = z.object({
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(50),
  items: z.array(recordSchema).max(50),
}).strict()
const updateSchema = z.object({ updated: z.boolean(), record: recordSchema }).strict()
const singleDeleteSchema = z.object({
  id: z.string(),
  deleted: z.boolean(),
  mode: z.enum(['delete', 'forget']),
  undoToken: nullableText,
  suppressionCreated: z.boolean(),
}).strict()
const undoDeleteSchema = z.object({ id: z.string(), restored: z.boolean(), record: recordSchema }).strict()

const deleteSchema = z.object({
  deleted: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  byKind: byKindSchema,
}).strict()

const importSchema = z.object({
  imported: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  byKind: byKindSchema,
}).strict()

function result(typeSymbol, schema) {
  return Object.freeze({ mode: 'strict', create() { return this.schema }, typeSymbol, schema })
}

export const statsResult = result('@eduwork/dsh-memory#MemoryStats', statsSchema)
export const listResult = result('@eduwork/dsh-memory#MemoryList', listSchema)
export const updateResult = result('@eduwork/dsh-memory#MemoryUpdate', updateSchema)
export const singleDeleteResult = result('@eduwork/dsh-memory#MemorySingleDelete', singleDeleteSchema)
export const undoDeleteResult = result('@eduwork/dsh-memory#MemoryUndoDelete', undoDeleteSchema)
export const deleteResult = result('@eduwork/dsh-memory#MemoryDeleteResult', deleteSchema)
export const importResult = result('@eduwork/dsh-memory#MemoryImportResult', importSchema)
export const exportResult = result('@eduwork/dsh-memory#MemoryExport', z.string().max(8_000_000))

export function stringParameter(name, max, typeSymbol) {
  return Object.freeze({
    name,
    wire: name,
    source: 'json',
    codec: Object.freeze({ mode: 'strict', create() { return this.schema }, typeSymbol, schema: z.string().max(max) }),
  })
}
