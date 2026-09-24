import { AsyncLocalStorage } from 'node:async_hooks'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { LlmError, assertUsableApiKey, resolveImageAttachmentAccess, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { Config as PiAiConfig, PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { createProvider } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import {
  configurableEntries, ENTERPRISE_DEFAULT_MAX_REQUEST_IMAGE_BYTES, ENTERPRISE_DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  ENTERPRISE_DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET, ENTERPRISE_DEFAULT_RETRY_POLICY, ENTERPRISE_SETTINGS_NAMESPACE,
  resolveEnterpriseProfiles, settingsBase,
} from './core.js'
import { TransformingEnterpriseAdapter } from './transform-adapter.js'
import { EnterpriseModelTransforms } from './transforms.js'
import { AuthorizationScopedAdapter } from './authorization-scope.js'

export const name = 'dsh-oidc-provider'
export const inject = ['llm']
export const SETTINGS_NAMESPACE = ENTERPRISE_SETTINGS_NAMESPACE
export const Config = PiAiConfig

function installEnterpriseSettings(ctx, rawConfig, hooks) {
  ctx.inject(['settings'], (settingsCtx) => {
    if (typeof settingsCtx.settings.installSection !== 'function') {
      // Account-managed routes come from the organization profile and its
      // authorization lease. Never project them into editable API-key forms.
      if (rawConfig.settingsEnabled !== true) return
      if (typeof rawConfig.providers?.get !== 'function' || !ctx.fiber.entry) {
        throw new Error('Editable enterprise providers require a DSH profile entry with live Config')
      }
      settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
      hooks.setSource(() => settingsBase(rawConfig))
      ctx.on('loader/volatile-update', () => hooks.onChange())
      return
    }
    settingsCtx.settings.installSection(
      ctx,
      SETTINGS_NAMESPACE,
      PiAiConfig,
      settingsBase(rawConfig),
      {
        ...hooks,
        validate(value) {
          assertServiceableEnterpriseProviders(value)
          hooks.validate?.(value)
        },
      },
    )
  })
}

function apiKeyAuth(displayName) {
  return {
    name: displayName,
    resolve: ({ credential }) => Promise.resolve({
      auth: credential?.key === undefined ? {} : { apiKey: credential.key },
      source: displayName,
    }),
  }
}

export function profilesFrom(rawConfig) {
  const profiles = new Map()
  for (const route of resolveEnterpriseProfiles(rawConfig)) {
    profiles.set(route.provider, {
      provider: route.provider,
      displayName: route.displayName,
      apiKeyEnv: route.credentialRef,
      maxRequestImageBytes: route.maxRequestImageBytes,
      requestImagePixelBudget: route.requestImagePixelBudget,
      requestImageMaxBytes: route.requestImageMaxBytes,
      streamIdleTimeoutMs: route.streamIdleTimeoutMs,
      retryPolicy: resolveRetryPolicy(route.retryPolicy, `${name}: ${route.provider}.retryPolicy`),
      configuredMaxTokens: route.configuredMaxTokens,
      modelPolicies: route.modelPolicies,
      // DSH 0.1.5-rc.1 reads per-model configuration errors before resolution.
      // Our declarative profiles validate eagerly, so a successfully constructed
      // provider has no deferred errors. Earlier adapters ignore this field.
      modelErrors: new Map(),
      piProvider: createProvider({
        id: route.provider,
        name: route.displayName,
        baseUrl: route.baseURL,
        auth: { apiKey: apiKeyAuth(route.displayName) },
        models: route.models,
        api: openAICompletionsApi(),
      }),
    })
  }
  return profiles
}

export function assertServiceableEnterpriseProviders(rawConfig) {
  profilesFrom(rawConfig)
}

function isolatedPiAiAuth() {
  const stored = new Map()
  return {
    credentials: {
      read: id => Promise.resolve(stored.get(id)),
      list: () => Promise.resolve([]),
      async modify(id, mutate) {
        const next = await mutate(stored.get(id))
        if (next === undefined) stored.delete(id)
        else stored.set(id, next)
        return next
      },
      delete: id => { stored.delete(id); return Promise.resolve() },
    },
    authContext: {
      env: () => Promise.resolve(undefined),
      fileExists: () => Promise.resolve(false),
    },
  }
}

export function resolveEnterpriseImageAccess(ctx, attachments, ref) {
  return resolveImageAttachmentAccess(
    attachments,
    hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
    ref,
  )
}

export function apply(ctx, rawConfig = {}) {
  const callAuthorization = new AsyncLocalStorage()
  const transforms = new EnterpriseModelTransforms(ctx)
  let current = () => settingsBase(rawConfig)
  let profiles = profilesFrom(current())

  const baseAdapter = new PiAiAdapter({
    profiles: () => profiles,
    auth: isolatedPiAiAuth(),
    resolveApiKey: async (provider, profile) => {
      if (await rawConfig.beforeResolveCredential?.(provider) === false) {
        throw new LlmError(`${name}: organization sign-in is required for provider route "${provider}"`, 'MISSING_CREDENTIAL')
      }
      const ref = profile.apiKeyEnv
      const credentials = ctx.get('credentials')
      const lease = callAuthorization.getStore()
      const hit = lease
        ? (await lease.resolveCredential(provider))?.value
        : typeof rawConfig.resolveCredential === 'function'
        ? (await rawConfig.resolveCredential(provider))?.value
        : credentials === undefined
        ? launchEnvironmentOf(ctx).get(ref)?.value
        : (await credentials.resolve(ref))?.value
      if (typeof hit === 'string' && hit.length > 0) return assertUsableApiKey(hit, name, ref)
      throw new LlmError(`${name}: no credential for provider route "${provider}" (${ref})`, 'MISSING_CREDENTIAL')
    },
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveEnterpriseImageAccess(ctx, attachments, ref),
  })

  const transforming = new TransformingEnterpriseAdapter(baseAdapter, transforms, (provider, model) => (
    profiles.get(provider)?.modelPolicies.get(model) ?? { reasoning: true, supportsReasoningEffort: true }
  ))
  const adapter = typeof rawConfig.createAuthorizationScope === 'function'
    ? new AuthorizationScopedAdapter(transforming, callAuthorization, rawConfig.createAuthorizationScope)
    : transforming
  let registration
  let directory
  const nativeSettings = typeof ctx.get('settings')?.installSection !== 'function'
  const editableDirectory = !nativeSettings || rawConfig.settingsEnabled === true
  const settingsNs = nativeSettings ? ctx.fiber.entry?.options.id ?? SETTINGS_NAMESPACE : SETTINGS_NAMESPACE
  const replaceProfiles = next => {
    const previous = profiles
    profiles = next
    try {
      if (registration) registration.replace([...next.keys()])
      else if (next.size) registration = ctx.llm.registerAdapter([...next.keys()], adapter)
      if (directory) directory.replace(configurableEntries(next, settingsNs))
      else if (next.size && editableDirectory) directory = ctx.llm.registerConfigurableProviders(configurableEntries(next, settingsNs))
    } catch (error) {
      profiles = previous
      registration?.replace([...previous.keys()])
      throw error
    }
  }
  if (profiles.size) replaceProfiles(profiles)
  const controller = { replaceConfig(config) { replaceProfiles(profilesFrom(config)) } }

  if (rawConfig.settingsEnabled !== true) {
    installEnterpriseSettings(ctx, rawConfig, { setSource() {}, onChange() {} })
    return controller
  }

  const refresh = () => {
    const next = profilesFrom(current())
    replaceProfiles(next)
  }

  installEnterpriseSettings(ctx, rawConfig, {
    setSource(source) { current = source },
    onChange() {
      try { refresh() }
      catch (error) {
        ctx.logger.error('dsh-oidc-provider: keeping previous routes after a refused settings update')
        ctx.logger.error(error)
      }
    },
  })
  return controller
}

export { resolveEnterpriseProfiles } from './core.js'
export { TransformingEnterpriseAdapter } from './transform-adapter.js'
export { EnterpriseModelTransforms } from './transforms.js'
export {
  configurableEntries, ENTERPRISE_DEFAULT_MAX_REQUEST_IMAGE_BYTES, ENTERPRISE_DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  ENTERPRISE_DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET, ENTERPRISE_DEFAULT_RETRY_POLICY,
  ENTERPRISE_SETTINGS_NAMESPACE, settingsBase,
}
