import { z } from 'zod'

const pkg = '@eduwork/dsh-oidc'
export const profileIdSchema = z.string().min(1).max(64)
export const loginIdSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/)
export const reconcileOptionsSchema = z.object({}).strict()
export const baseURLSchema = z.string().min(1).max(2048)
export const modelCatalogModeSchema = z.enum(['discovery', 'manual'])
export const configurationTargetSchema = z.enum(['config', 'examples'])
export const openConfigurationResult = Object.freeze({
  mode: 'strict', typeSymbol: `${pkg}#OpenConfigurationResult`,
  schema: z.object({ opened: z.literal(true) }).strict(),
})
export const enterpriseSelectionResult = Object.freeze({
  mode: 'strict', typeSymbol: `${pkg}#EnterpriseSelectionResult`,
  schema: z.object({ changed: z.boolean(), selection: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() }).strict().optional() }).strict(),
})
export const enterpriseSelectionOptionsSchema = z.object({ onlyIfMissing: z.boolean().optional() }).strict()

const brandSchema = z.object({
  productName: z.string().optional(), organizationName: z.string().optional(), mark: z.string().optional(),
  logoURL: z.string().optional(), primaryColor: z.string().optional(), loginTitle: z.string().optional(),
  loginDescription: z.string().optional(), supportURL: z.string().optional(),
}).strict()

const publicProfileSchema = z.object({
  id: z.string(), displayName: z.string(), organization: z.string(), brand: brandSchema,
  credentialRef: z.string(),
  provider: z.object({
    id: z.string(), displayName: z.string(),
    models: z.array(z.object({ id: z.string(), name: z.string(), input: z.array(z.enum(['text', 'image'])) }).strict()),
  }).strict().optional(),
}).strict()

const accountSchema = z.object({
  profileID: z.string(), displayName: z.string(), organization: z.string(), state: z.string(),
  userName: z.string().optional(), affiliation: z.string().optional(), accessExpiresAt: z.string().optional(),
  credentialRef: z.string(), credentialReady: z.boolean(), credentialState: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
}).strict()

export const runtimeModelSchema = z.object({
  id: z.string().min(1).max(256), name: z.string().max(256).optional(),
  upstreamModelID: z.string().max(256).optional(), contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  input: z.array(z.enum(['text', 'image', 'audio', 'video'])).optional(),
  reasoning: z.boolean().optional(), reasoningEfforts: z.union([z.literal(false), z.record(z.string(), z.string().nullable())]).optional(),
  defaultReasoningEffort: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  compat: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const runtimeModelsSchema = z.array(runtimeModelSchema).max(128)

export const resourcesResult = Object.freeze({
  mode: 'strict', typeSymbol: `${pkg}#Resources`,
  schema: z.object({
    profileID: z.string(), modelSource: z.string(), models: runtimeModelsSchema, issues: z.array(z.string()),
  }).strict(),
})

const managementProfileSchema = z.object({
  id: z.string(), displayName: z.string(), organization: z.string(), baseURL: z.string(),
  builtIn: z.boolean(), configured: z.boolean(), enabled: z.boolean(), providerID: z.string(),
  runtime: z.object({
    displayName: z.string(), modelSource: z.string().optional(), reasoning: z.string().optional(),
    defaultContextWindow: z.number().int().positive().optional(), defaultMaxTokens: z.number().int().positive().optional(),
    compat: z.record(z.string(), z.unknown()).optional(), models: runtimeModelsSchema,
  }).strict(),
}).strict()

export const configurationResult = Object.freeze({
  mode: 'strict', typeSymbol: `${pkg}#Configuration`,
  schema: z.object({ schemaVersion: z.literal('dsh-oidc/v1alpha1'), uiMode: z.enum(['standard', 'models-only', 'external']), profiles: z.array(publicProfileSchema),
    manageProductBrand: z.boolean().optional(), configFile: z.object({ path: z.string(), examplesPath: z.string(), canOpen: z.boolean() }).strict().optional(),
  }).strict(),
})

export const managementResult = Object.freeze({
  mode: 'strict', typeSymbol: `${pkg}#ManagementConfiguration`,
  schema: z.object({
    schemaVersion: z.literal('dsh-oidc/management/v1alpha1'), mode: z.enum(['profile', 'native']),
    activeProfileID: z.string(), restartRequired: z.boolean(),
    capabilities: z.object({ manageProfiles: z.boolean(), manageModels: z.boolean(), restart: z.boolean() }).strict(),
    profiles: z.array(managementProfileSchema),
  }).strict(),
})

export const restartResult = Object.freeze({
  mode: 'strict', typeSymbol: `${pkg}#RestartResult`,
  schema: z.object({ restarting: z.literal(true) }).strict(),
})

export const accountResult = Object.freeze({ mode: 'strict', typeSymbol: `${pkg}#AccountStatus`, schema: accountSchema })

export const beginResult = Object.freeze({
  mode: 'strict', typeSymbol: `${pkg}#BeginResult`,
  schema: z.union([
    z.object({ mode: z.literal('redirect'), authorizationURL: z.string().url() }).strict(),
    z.object({ mode: z.literal('completed'), status: accountSchema }).strict(),
    z.object({ mode: z.literal('external'), loginID: loginIdSchema, expiresAt: z.string().datetime() }).strict(),
  ]),
})

export const loginResult = Object.freeze({
  mode: 'strict', typeSymbol: `${pkg}#LoginResult`,
  schema: z.object({
    loginID: loginIdSchema, profileID: profileIdSchema, expiresAt: z.string().datetime(),
    state: z.enum(['pending', 'completed', 'cancelled', 'expired', 'failed']),
    status: accountSchema.optional(), errorCode: z.string().optional(),
  }).strict(),
})

export function jsonParameter(name, schema, typeSymbol) {
  return Object.freeze({ name, wire: name, source: 'json', codec: Object.freeze({ mode: 'strict', typeSymbol, schema }) })
}
