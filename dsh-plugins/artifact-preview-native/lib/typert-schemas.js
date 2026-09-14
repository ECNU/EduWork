import { z } from 'zod'

const stringParameter = name => Object.freeze({ name, wire: name, source: 'json', codec: Object.freeze({ mode: 'strict', typeSymbol: `@chatecnu-work/dsh-artifact-preview-native#${name}`, schema: z.string() }) })
export const parameters = [stringParameter('sessionId'), stringParameter('relativePath')]
const officePreviewDescription = z.object({
  schemaVersion: z.literal(1), kind: z.enum(['slides', 'document']),
  sourceHash: z.string(), rendererVersion: z.string(), fontFingerprint: z.string(), cacheKey: z.string(),
  pageCount: z.number().int().positive().nullable(), pageWidth: z.number().positive().nullable(), pageHeight: z.number().positive().nullable(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
}).strict()
export const result = Object.freeze({
  mode: 'strict', typeSymbol: '@chatecnu-work/dsh-artifact-preview-native#ArtifactPreview',
  schema: z.object({ path: z.string(), name: z.string(), mime: z.string(), bytes: z.number(), encoding: z.enum(['utf8', 'base64', 'url']), data: z.string(), downloadUrl: z.string().optional(), officePreview: officePreviewDescription.optional() }).strict(),
})
export const revealResult = Object.freeze({
  mode: 'strict', typeSymbol: '@chatecnu-work/dsh-artifact-preview-native#ArtifactReveal',
  schema: z.object({ path: z.string(), revealed: z.literal(true) }).strict(),
})
const importFileSchema = z.object({
  name: z.string().min(1).max(512),
  mediaType: z.string().max(255),
  bytes: z.number().int().min(0).max(64 * 1024 * 1024),
  data: z.string(),
}).strict()
export const importParameters = [
  stringParameter('sessionId'),
  Object.freeze({
    name: 'files', wire: 'files', source: 'json',
    codec: Object.freeze({
      mode: 'strict', typeSymbol: '@chatecnu-work/dsh-artifact-preview-native#WorkspaceImportFiles',
      schema: z.array(importFileSchema).min(1).max(20),
    }),
  }),
]
export const nativeImportParameters = [stringParameter('sessionId'), stringParameter('grantID')]
export const importResult = Object.freeze({
  mode: 'strict', typeSymbol: '@chatecnu-work/dsh-artifact-preview-native#WorkspaceImportResult',
  schema: z.object({
    files: z.array(z.object({ path: z.string(), name: z.string(), bytes: z.number().int().min(0) }).strict()),
  }).strict(),
})
