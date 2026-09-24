export const UPSTREAM_WELCOME_NOTICE_NAMESPACE = 'ui-onboarding'

// DSH currently exposes the welcome notice only through its durable
// acknowledgement setting, not through deployment configuration. A branded
// product may explicitly acknowledge the reviewed upstream copy during Host
// composition so end users are not presented with a Harness-developer notice.
// Omitting the version preserves native DSH behavior.
export async function acknowledgeUpstreamWelcomeNotice(settings, rawVersion, timing = {}) {
  const version = typeof rawVersion === 'string' ? rawVersion.trim() : ''
  if (!version) return false
  const waitMs = Number.isFinite(timing.waitMs) ? Math.max(0, timing.waitMs) : 5000
  const pollMs = Number.isFinite(timing.pollMs) ? Math.max(1, timing.pollMs) : 25
  const deadline = Date.now() + waitMs
  const namespace = typeof settings.get === 'function' ? UPSTREAM_WELCOME_NOTICE_NAMESPACE : 'ui-settings-general'
  const read = () => typeof settings.get === 'function' ? settings.get(namespace)
    : settings.describe().find(row => row.ns === namespace)?.value
  let current = read()
  // Host Loader entries activate concurrently. ui-settings-general owns this
  // namespace and may register a few turns after the product policy starts.
  while (current === undefined && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, pollMs))
    current = read()
  }
  // Forward compatible: if upstream removes the notice/namespace, there is
  // nothing left for the product to suppress.
  if (current === undefined || current?.welcomeNoticeVersion === version) return false
  await settings.update(namespace, { welcomeNoticeVersion: version })
  return true
}
