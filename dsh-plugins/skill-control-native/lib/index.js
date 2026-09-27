import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { SETTINGS_NAMESPACE } from '@chatecnu-work/dsh-skill-settings-native'
import { effectiveDisabled, filterObservation, requiredCapability, requiredCredential, requiredAccountBinding, accountBindingKey, accountBindingAvailable } from './core.js'

export const name = 'skill-control-native'
export const inject = ['skills', 'credentials', 'settings']
export { SETTINGS_NAMESPACE }

function resolveConfig(raw = {}) {
  const skillDir = raw.skillDir ?? process.env.DSH_BUNDLED_SKILL_DIR
  if (typeof skillDir !== 'string' || skillDir.trim().length === 0) {
    throw new Error('skill-control-native requires skillDir or DSH_BUNDLED_SKILL_DIR')
  }
  return {
    skillDir,
    providerName: typeof raw.providerName === 'string' && raw.providerName.length > 0 ? raw.providerName : 'filesystem',
    customSkillDirs: Array.isArray(raw.customSkillDirs) ? raw.customSkillDirs : [],
  }
}

export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  let invalidate = () => {}
  let imageSource
  let filesystem
  const settingsSource = () => (typeof ctx.settings.get === 'function'
    ? ctx.settings.get(SETTINGS_NAMESPACE)
    : ctx.settings.describe().find(row => row.ns === SETTINGS_NAMESPACE)?.value)
    ?? { disabled: [], enabled: [], defaultDisabled: [] }

  ctx.skills.registerProvider((control) => {
    invalidate = control.invalidate
    const delegate = new FileSystemSkillProvider(ctx, control, {
      providerName: config.providerName,
      includeDefaultRoots: true,
      bundledSkillDir: config.skillDir,
      customSkillDirs: config.customSkillDirs,
    })
    filesystem = delegate
    return {
      name: config.providerName,
      async list(options) {
        const observation = await delegate.list(options)
        const candidates = Array.isArray(observation) ? observation : observation.candidates
        const refs = [...new Set(candidates.map(requiredCredential).filter(Boolean))]
        const configured = new Set()
        await Promise.all(refs.map(async (ref) => {
          try {
            if ((await ctx.credentials.describe(credentialRef(ref))).configured) configured.add(ref)
          } catch {
            // Enterprise-gated Skills fail closed when credential state is unavailable.
          }
        }))
        const capabilities = new Set()
        if (candidates.some(candidate => requiredCapability(candidate) === 'image-generation')) {
          const source = imageSource
          try {
            const providers = await source?.images?.list()
            // A provider read can finish after the optional service was removed
            // or replaced. Its old answer must not reopen a cached capability.
            if (source === imageSource && providers?.some(provider => provider.available === true)) capabilities.add('image-generation')
          } catch {
            // A missing or unready generic provider does not expose the skill.
          }
        }
        const availableBindings = new Set()
        const bindings = new Map(candidates.map(requiredAccountBinding).filter(Boolean).map(binding => [accountBindingKey(binding), binding]))
        await Promise.all([...bindings].map(async ([key, binding]) => {
          try {
            const account = ctx.get?.('oidcAccounts')
            if (await accountBindingAvailable(account, binding)) availableBindings.add(key)
          } catch { /* An unrelated login must not expose this institution's skill. */ }
        }))
        return filterObservation(observation, effectiveDisabled(settingsSource()), configured, capabilities, availableBindings)
      },
      get(candidate, options) { return delegate.get(candidate, options) },
    }
  })

  // Shared is optional: public profiles without media services still discover
  // their ordinary skills. A dependency scope follows late mount/replacement
  // and invalidates both positive and negative catalog caches on every change.
  ctx.inject(['artifactServices'], (sharedCtx) => {
    const source = { images: sharedCtx.artifactServices.images }
    imageSource = source
    invalidate()
    sharedCtx.on('artifact-services/images-changed', () => { invalidate() })
    sharedCtx.effect(() => () => {
      if (imageSource !== source) return
      imageSource = undefined
      invalidate()
    })
  })

  // Credential updates are rare, and metadata may declare more institution
  // refs later. Invalidate the tiny catalog generically instead of coupling
  // this lifecycle seam back to ECNU's current key name.
  ctx.on('credentials/reference-updated', () => { invalidate() })
  ctx.on('credentials/updated', () => { invalidate() }) // Older credential providers.
  ctx.on('oidc/accounts-changed', () => { invalidate() })
  ctx.on('settings/updated', (namespace) => {
    if (namespace === SETTINGS_NAMESPACE) invalidate()
  })
  ctx.on('settings/document-updated', (namespace) => {
    if (namespace === SETTINGS_NAMESPACE) invalidate()
  })
  // Native filesystem providers own watchers from 0.1.7 onward. A preset can
  // be disabled or reloaded while the Host stays alive; close those watchers.
  ctx.effect(() => () => filesystem?.dispose?.(), 'product skill filesystem watcher')
}
