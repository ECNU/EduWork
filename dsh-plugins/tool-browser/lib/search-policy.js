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
