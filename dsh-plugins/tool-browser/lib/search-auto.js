import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { DeepSeekSearchProvider, DEEPSEEK_DEFAULT_BASE_URL, DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_DEFAULT_API_VERSION, DEEPSEEK_DEFAULT_MAX_TOKENS, DEEPSEEK_DEFAULT_MAX_USES } from '@deepseek-ai/dsh-web-search-deepseek'
import { createBrowserSearchProvider } from './search-provider.js'
import { searchWithAvailableProvider } from './search-policy.js'

export const name = 'eduwork-search'
export const inject = ['web']
export function apply(ctx) {
  const browser = createBrowserSearchProvider(ctx)
  ctx.web.registerSearchProvider({
    id: name,
    available: () => true,
    search: (request, signal) => searchWithAvailableProvider({ request, signal, browser,
      settings: () => ctx.get('settings')?.get('web-search-deepseek'),
      resolveCredential: async reference => {
        const credentials = ctx.get('credentials')
        return credentials ? (await credentials.resolve(credentialRef(reference)))?.value : launchEnvironmentOf(ctx).get(reference)?.value
      },
      deepseek: config => new DeepSeekSearchProvider(() => ({
        apiKey: config.apiKey, apiKeyEnv: config.apiKeyEnv || 'DEEPSEEK_API_KEY',
        baseURL: config.baseURL || launchEnvironmentOf(ctx).get('DEEPSEEK_SEARCH_BASE_URL')?.value || DEEPSEEK_DEFAULT_BASE_URL,
        model: config.model || DEEPSEEK_DEFAULT_MODEL,
        apiVersion: config.apiVersion || DEEPSEEK_DEFAULT_API_VERSION,
        maxTokens: config.maxTokens ?? DEEPSEEK_DEFAULT_MAX_TOKENS,
        maxUses: config.maxUses ?? DEEPSEEK_DEFAULT_MAX_USES,
        recordRequest: value => ctx.get('agents')?.currentInitiator()?.session.append('web/deepseek-search-llm-request', value),
      })),
    }),
  })
}
