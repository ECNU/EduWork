import { statSync } from 'node:fs'

// Reuse the institution adapter's relocatable resource binding. A standalone
// Host without desktop resources may use the official provider's discovery.
export function browserConfig(raw = {}, environment = process.env) {
  if (raw.headless !== undefined && typeof raw.headless !== 'boolean') throw new Error('browser headless must be a boolean')
  const executablePath = raw.executablePath ?? environment.DSH_MEDIA_BROWSER
  if (executablePath !== undefined && (typeof executablePath !== 'string' || !statSync(executablePath, { throwIfNoEntry: false })?.isFile())) {
    throw new Error('The configured Chromium is missing; restore the complete EduWork package')
  }
  const toolCallTimeoutMs = raw.toolCallTimeoutMs ?? 120000
  if (!Number.isSafeInteger(toolCallTimeoutMs) || toolCallTimeoutMs < 1000 || toolCallTimeoutMs > 300000) throw new Error('browser toolCallTimeoutMs must be between 1000 and 300000')
  return { mode: 'launch', headless: raw.headless ?? true, ...(executablePath === undefined ? {} : { executablePath }), toolCallTimeoutMs }
}
