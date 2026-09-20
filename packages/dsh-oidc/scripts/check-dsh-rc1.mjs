import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { LlmRuntime, assertUsableApiKey, resolveImageAttachmentAccess, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { Config as PiAiConfig, PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { createProvider } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { enterpriseProviderConfig, normalizeEnterpriseProfile } from '../src/host/profile.js'
import { settingsBase } from '../src/host/provider/core.js'
import OidcAccountService from '../src/host/index.js'

const require = createRequire(import.meta.url)
const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const supportedDshVersions = new Set(['0.1.2-rc.1', '0.1.3-alpha.1', '0.1.3-alpha.2', '0.1.5-alpha.1', '0.1.5-rc.1'])
const expectedDshPeerRange = '0.1.2-rc.1 || 0.1.3-alpha.1 || 0.1.3-alpha.2 || 0.1.5-alpha.1 || 0.1.5-rc.1'

for (const [name, version] of Object.entries(manifest.peerDependencies)) {
  if (name.startsWith('@deepseek-ai/dsh-')) {
    assert.equal(version, expectedDshPeerRange, `${name} must support exactly the reviewed DSH baselines`)
  }
}

const dshLlmPackage = require.resolve('@deepseek-ai/dsh-llm/package.json')
const deepseekScope = dirname(dirname(dshLlmPackage))
const installed = []
const installedVersions = new Set()
for (const entry of await readdir(deepseekScope, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('dsh-')) continue
  const packagePath = join(deepseekScope, entry.name, 'package.json')
  let candidate
  try { candidate = JSON.parse(await readFile(packagePath, 'utf8')) }
  catch { continue }
  installed.push(`${candidate.name}@${candidate.version}`)
  assert.ok(supportedDshVersions.has(candidate.version), `${candidate.name}@${candidate.version} is outside the reviewed DSH baselines`)
  installedVersions.add(candidate.version)
}
assert.ok(installed.length >= 20, 'the locked DSH peer closure is unexpectedly incomplete')
assert.equal(installedVersions.size, 1, `mixed DSH versions are unsupported: ${[...installedVersions].join(', ')}`)
const installedDshVersion = [...installedVersions][0]
assert.equal(installedDshVersion, process.env.DSH_OIDC_EXPECT_DSH ?? manifest.devDependencies['@deepseek-ai/dsh-llm'],
  'the active Runtime differs from the selected development/CI baseline')

assert.equal(typeof SettingsProvider.prototype.installSection, 'function', 'settings.installSection is unavailable')
assert.equal(typeof LlmRuntime.prototype.registerAdapter, 'function', 'llm.registerAdapter is unavailable')
assert.equal(typeof LlmRuntime.prototype.registerConfigurableProviders, 'function', 'llm.registerConfigurableProviders is unavailable')
assert.equal(typeof PiAiAdapter.prototype.prepareCall, 'function', 'PiAiAdapter.prepareCall is unavailable')
assert.equal(typeof PiAiAdapter.prototype.stream, 'function', 'PiAiAdapter.stream is unavailable')
assert.equal(typeof WebServer.prototype.register, 'function', 'webServer.register is unavailable')
assert.equal(typeof launchEnvironmentOf, 'function', 'launchEnvironmentOf is unavailable')
assert.equal(typeof Remote, 'function', 'Typert Remote decorator is unavailable')
assert.equal(typeof TypertRemoteService, 'function', 'TypertRemoteService is unavailable')
assert.equal(typeof assertUsableApiKey, 'function', 'assertUsableApiKey is unavailable')
assert.equal(typeof resolveImageAttachmentAccess, 'function', 'resolveImageAttachmentAccess is unavailable')
assert.equal(typeof resolveRetryPolicy, 'function', 'resolveRetryPolicy is unavailable')
assert.equal(typeof PiAiConfig, 'function', 'PiAi settings schema is unavailable')
assert.equal(typeof createProvider, 'function', 'pi-ai createProvider is unavailable')
assert.equal(typeof openAICompletionsApi, 'function', 'pi-ai OpenAI Completions adapter is unavailable')
assert.equal(credentialRef('EDUWORK_API_KEY'), 'EDUWORK_API_KEY')

const oidcService = new OidcAccountService(new Context(), { allowEmptyProfiles: true, backend: 'desktop' })
assert.deepEqual(remoteMethods(oidcService).map(marker => marker.method), [
  'configuration', 'openConfiguration', 'status', 'resources', 'begin', 'loginStatus', 'cancelLogin', 'reconcile', 'selectEnterpriseModel', 'logout', 'management',
  'activate', 'configure', 'addCustom', 'updateCustom', 'removeProfile', 'configureModels', 'restart',
], 'OidcAccountService must preserve every Typert Remote marker')

const example = normalizeEnterpriseProfile(JSON.parse(await readFile(new URL('examples/enterprise-profile.example.json', root), 'utf8')))
assert.deepEqual(enterpriseProviderConfig(new Map([[example.id, example]])).providers, {}, 'No model route before discovery')
const discovered = { ...example, provider: { ...example.provider, baseURL: 'https://models.example.edu/v1' } }
const providerBase = settingsBase(enterpriseProviderConfig(new Map([[example.id, discovered]])))
assert.doesNotThrow(() => PiAiConfig(providerBase), 'the public Enterprise Profile must satisfy the reviewed PiAi settings schema')
class ProbeSettingsProvider extends SettingsProvider {
  load() { return Promise.resolve({}) }
  persist() { return Promise.resolve() }
}
const settingsCtx = new Context()
const settingsProvider = new ProbeSettingsProvider(settingsCtx)
let providerSource
assert.doesNotThrow(() => settingsProvider.installSection(
  settingsCtx,
  'provider-enterprise',
  PiAiConfig,
  providerBase,
  { setSource(source) { providerSource = source }, onChange() {} },
), 'the public Enterprise Profile must install through the reviewed SettingsProvider')
assert.equal(providerSource().providers['example-ai'].displayName, 'Example AI')
assert.equal(providerSource().providers['example-ai'].models.length, 2)

const clientContracts = [
  ['@deepseek-ai/dsh-api-remotes', 'lib/client.js', '$mount'],
  ['@deepseek-ai/dsh-client-ui-settings-models', 'lib/client.js', 'settings.models.footer'],
  ['@deepseek-ai/dsh-client-ui-settings', 'lib/types/client/contract/slots.d.ts', 'settings.onboarding'],
  ['@deepseek-ai/dsh-client-ui-settings', 'lib/types/client/contract/slots.d.ts', 'settings.general.item'],
  ['@deepseek-ai/dsh-client-ui-settings-general', 'lib/client.js', 'settings.general.item'],
  ['@deepseek-ai/dsh-client-ui-conversation', 'lib/types/client/contract/slots.d.ts', 'conversation.hero.brand.mark'],
  ['@deepseek-ai/dsh-client-ui-sidebar', 'lib/client.js', 'sidebar.brand.mark'],
  ['@deepseek-ai/dsh-client-ui-sidebar', 'lib/client.js', 'sidebar.brand.name'],
  ['@deepseek-ai/dsh-client-ui-sidebar', 'lib/client.js', 'sidebar.footer.action'],
  ['@deepseek-ai/dsh-client-ui-theme', 'lib/client.js', 'overrideTokens'],
]
if (['0.1.5-alpha.1', '0.1.5-rc.1'].includes(installedDshVersion)) clientContracts.push(
  ['@deepseek-ai/dsh-api-remotes', 'lib/index.js', 'credentials/reference-updated'],
  ['@deepseek-ai/dsh-agent-default-model', 'lib/index.js', 'saveSelection(next)'],
  ['@deepseek-ai/dsh-client-ui-model-selection', 'lib/types/client/service.d.ts', 'directoryFor'],
  ['@deepseek-ai/dsh-api-session-controller', 'lib/types/client/contract/sessions.d.ts', 'subagentAddress'],
)
for (const [name, relativePath, marker] of clientContracts) {
  const packageRoot = dirname(require.resolve(`${name}/package.json`))
  const content = await readFile(join(packageRoot, relativePath), 'utf8')
  assert.ok(content.includes(marker), `${name} no longer exposes ${marker}`)
}
const clientSource = await readFile(new URL('src/client/index.ts', root), 'utf8')
assert.ok(clientSource.includes('enterpriseBrandPriority = -100'), 'enterprise brand slots must explicitly shadow official default-priority occupants')

console.log(`DSH ${installedDshVersion} Host, Provider, Settings, Typert, WebServer, credentials, attachments, and Client contracts passed (${installed.length} coherent DSH packages).`)
