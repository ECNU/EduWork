import z from '@deepseek-ai/schemastery'

export const SETTINGS_NAMESPACE = 'dsh-knowledge-studio'

export const DEFAULT_SETTINGS = Object.freeze({
  maxTextFileBytes: 1024 * 1024,
  maxPdfFileBytes: 64 * 1024 * 1024,
  maxFiles: 20_000,
})

export const KnowledgeStudioSettingsSchema = z.object({
  maxTextFileBytes: z.number().step(1).min(64 * 1024).max(64 * 1024 * 1024).default(DEFAULT_SETTINGS.maxTextFileBytes),
  maxPdfFileBytes: z.number().step(1).min(1024 * 1024).max(256 * 1024 * 1024).default(DEFAULT_SETTINGS.maxPdfFileBytes),
  maxFiles: z.number().step(1).min(1).max(100_000).default(DEFAULT_SETTINGS.maxFiles),
})

// DSH 0.1.7 owns persistence and live validation through the plugin Config.
// Keep the legacy registration path until the new Runtime is promoted.
export const Config = typeof z.string().volatile === 'function'
  ? z.object(Object.fromEntries(Object.entries(KnowledgeStudioSettingsSchema.dict).map(([key, field]) => [key, field.volatile()])))
  : undefined

export function liveSettings(config) {
  return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key => [key, config[key].get()]))
}

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
