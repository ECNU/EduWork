import z from '@deepseek-ai/schemastery'

export const SETTINGS_NAMESPACE = 'dsh-knowledge-studio'

export const DEFAULT_SETTINGS = Object.freeze({
  maxTextFileBytes: 1024 * 1024,
  maxPdfFileBytes: 64 * 1024 * 1024,
  maxFiles: 20_000,
})

export const KnowledgeStudioSettingsSchema = z.object({
  maxTextFileBytes: z.number().default(DEFAULT_SETTINGS.maxTextFileBytes),
  maxPdfFileBytes: z.number().default(DEFAULT_SETTINGS.maxPdfFileBytes),
  maxFiles: z.number().default(DEFAULT_SETTINGS.maxFiles),
})

export function validateSettings(value) {
  if (!Number.isInteger(value.maxTextFileBytes) || value.maxTextFileBytes < 64 * 1024 || value.maxTextFileBytes > 64 * 1024 * 1024) {
    throw new Error('maxTextFileBytes must be an integer between 64 KiB and 64 MiB')
  }
  if (!Number.isInteger(value.maxPdfFileBytes) || value.maxPdfFileBytes < 1024 * 1024 || value.maxPdfFileBytes > 256 * 1024 * 1024) {
    throw new Error('maxPdfFileBytes must be an integer between 1 MiB and 256 MiB')
  }
  if (!Number.isInteger(value.maxFiles) || value.maxFiles < 1 || value.maxFiles > 100_000) {
    throw new Error('maxFiles must be an integer between 1 and 100000')
  }
}

export function mergeDefaultSettings(config = {}) {
  return {
    ...DEFAULT_SETTINGS,
    maxTextFileBytes: config.maxTextFileBytes ?? DEFAULT_SETTINGS.maxTextFileBytes,
    maxPdfFileBytes: config.maxPdfFileBytes ?? DEFAULT_SETTINGS.maxPdfFileBytes,
    maxFiles: config.maxFiles ?? DEFAULT_SETTINGS.maxFiles,
  }
}
