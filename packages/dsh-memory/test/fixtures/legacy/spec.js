import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const nullableText = z.string().nullable()
export const MemorySourceSchema = z.object({
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

export const MemoryRecordSchema = z.object({
  id: z.string(),
  content: z.string(),
  kind: z.enum(['fact', 'preference', 'decision', 'lesson', 'todo', 'note']),
  tags: z.array(z.string()),
  scope: z.enum(['user', 'project']),
  project: nullableText,
  importance: z.number().int().min(1).max(3),
  sources: z.array(MemorySourceSchema),
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

export const MemoryTombstoneSchema = z.object({
  id: z.string(),
  fingerprint: z.string(),
  tokenHashes: z.array(z.string()).max(256),
  scope: z.enum(['user', 'project']),
  project: nullableText,
  sourceRecordId: z.string(),
  reason: z.literal('user-forgotten'),
  createdAt: z.string(),
}).strict()

export const SessionPolicySchema = z.object({
  sessionId: z.string(),
  use_memories: z.boolean().nullable(),
  generate_memories: z.boolean().nullable(),
  search_prior_chats: z.boolean().nullable().optional(),
  updatedAt: nullableText,
}).strict()

export const memoryDomain = defineDomain({
  name: 'local_memory',
  version: 1,
  layout: 'per-record',
  tables: {
    records: domainTable(MemoryRecordSchema),
    session_policies: domainTable(SessionPolicySchema),
    tombstones: domainTable(MemoryTombstoneSchema),
  },
})
