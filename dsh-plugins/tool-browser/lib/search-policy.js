// Select before execution, using a resolved credential rather than the
// existence of an async resolver. Never send an institutional key implicitly
// to a model vendor, and never mask a configured service's actual error.
export async function searchWithAvailableProvider({ request, signal, settings, resolveCredential, deepseek, browser }) {
  signal?.throwIfAborted()
  const current = settings()
  // An absent/inactive plugin must not be re-enabled by an ambient API key.
  if (current === undefined) return browser.search(request, signal)
  const config = structuredClone(current)
  const reference = config.apiKeyEnv || 'DEEPSEEK_API_KEY'
  const key = config.apiKey?.trim() || (await resolveCredential(reference))?.trim()
  signal?.throwIfAborted()
  if (!key) return browser.search(request, signal)
  return deepseek({ ...config, apiKey: key }).search(request, signal)
}

// DSH's settings service has no per-plugin read; take the live config of the
// active web-search-deepseek entry from the config editor. A disabled or absent
// entry is unavailable, independently of any ambient credential. DSH wraps
// these fields in Volatile values; JSON serialization silently loses them.
export function providerSettings(configEditor, id) {
  const entry = configEditor?.entries?.().find(row => row.options?.id === id && row.fiber?.state === 2)
  if (!entry) return undefined
  const config = entry.fiber.config
  return Object.fromEntries(['apiKey', 'apiKeyEnv', 'baseURL', 'model', 'apiVersion', 'maxTokens', 'maxUses']
    .map(key => [key, config[key].get()]))
}
