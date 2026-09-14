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
  let current = settings.get(UPSTREAM_WELCOME_NOTICE_NAMESPACE)
  // Host Loader entries activate concurrently. ui-settings-general owns this
  // namespace and may register a few turns after the product policy starts.
  while (current === undefined && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, pollMs))
    current = settings.get(UPSTREAM_WELCOME_NOTICE_NAMESPACE)
  }
  // Forward compatible: if upstream removes the notice/namespace, there is
  // nothing left for the product to suppress.
  if (current === undefined || current?.welcomeNoticeVersion === version) return false
  await settings.update(UPSTREAM_WELCOME_NOTICE_NAMESPACE, { welcomeNoticeVersion: version })
  return true
}
