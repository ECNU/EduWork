import { canonicalSkillName, effectiveDisabledSkills, normalizeSkillNames } from '@chatecnu-work/dsh-skill-settings-native/policy'
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/

export const normalizeDisabled = normalizeSkillNames
export const effectiveDisabled = effectiveDisabledSkills

export function requiredCredential(candidate) {
  const product = candidate?.metadata?.eduwork ?? candidate?.metadata?.chatecnu
  const ref = product?.credentialRef
  return typeof ref === 'string' && CREDENTIAL_REF.test(ref) ? ref : undefined
}

export function requiredCapability(candidate) {
  const capability = candidate?.metadata?.artifact?.capability
  return typeof capability === 'string' && /^[a-z]+(?:-[a-z]+)*$/.test(capability) ? capability : undefined
}

export function requiredAccountBinding(candidate) {
  const metadata = candidate?.metadata?.eduwork
  if (metadata?.oidcProfileId === undefined) return undefined
  return { profileID: metadata.oidcProfileId, credentialRef: requiredCredential(candidate), runtimeBaseURL: metadata.runtimeBaseURL }
}

export const accountBindingKey = binding => JSON.stringify([binding.profileID, binding.credentialRef, binding.runtimeBaseURL])

// A skill may follow an account while its tool's endpoint is configured
// separately. Explicit URL bindings remain strict; tools still authorize every
// request against their configured destination, regardless of skill visibility.
export async function accountBindingAvailable(accounts, binding) {
  if (binding.runtimeBaseURL !== undefined)
    return await accounts?.modelAuthorization?.(binding.profileID, binding.runtimeBaseURL) === true
  const status = await accounts?.status?.(binding.profileID)
  return status?.profileID === binding.profileID && status.state === 'connected' && status.credentialReady === true
}

export function candidateEnabled(candidate, disabled, configuredRefs, availableCapabilities = new Set(), availableBindings = new Set()) {
  if (disabled.has(canonicalSkillName(candidate.name))) return false
  const binding = requiredAccountBinding(candidate)
  if (binding && !availableBindings.has(accountBindingKey(binding))) return false
  const capability = requiredCapability(candidate)
  if (capability !== undefined && !availableCapabilities.has(capability)) return false
  const ref = requiredCredential(candidate)
  return Boolean(binding) || ref === undefined || configuredRefs.has(ref)
}

export function filterObservation(observation, disabled, configuredRefs, availableCapabilities, availableBindings) {
  const candidates = Array.isArray(observation) ? observation : observation.candidates
  const names = new Set(candidates.map(candidate => candidate.name))
  const selected = candidates.filter(candidate => {
    const canonical = canonicalSkillName(candidate.name)
    // A migrated capability has one discovery entry, including the slash menu.
    // Choose its current name before readiness checks: a missing provider must
    // not reactivate an old credential-bound implementation as a fallback.
    if (canonical !== candidate.name && names.has(canonical)) return false
    return candidateEnabled(candidate, disabled, configuredRefs, availableCapabilities, availableBindings)
  })
  if (Array.isArray(observation)) return selected
  return {
    ...observation,
    candidates: selected,
  }
}
