// Select before execution, using a resolved credential rather than the
// existence of an async resolver. Never send an institutional key implicitly
// to a model vendor, and never mask a configured service's actual error.
export async function searchWithAvailableProvider({ request, signal, settings, resolveCredential, deepseek, browser }) {
  signal?.throwIfAborted()
  const config = structuredClone(settings() ?? {})
  const reference = config.apiKeyEnv || 'DEEPSEEK_API_KEY'
  const key = config.apiKey?.trim() || (await resolveCredential(reference))?.trim()
  signal?.throwIfAborted()
  if (!key) return browser.search(request, signal)
  return deepseek({ ...config, apiKey: key }).search(request, signal)
}

// DSH's settings service has no per-plugin read; take the live config of the
// active web-search-deepseek entry from the config editor. A disabled or absent
// entry reads as unconfigured, so search falls back to the browser.
export function providerSettings(configEditor, id) {
  const entry = configEditor?.entries?.().find(row => row.options?.id === id && row.fiber?.state === 2)
  return entry ? JSON.parse(JSON.stringify(entry.fiber.config ?? entry.options.config ?? {})) : undefined
}
