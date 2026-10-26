import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'

// Only the argument choice is under test; the provider runtime is not installed here.
const stubs = {
  '@deepseek-ai/dsh-browser-use/brand': 'export const BrowserUseProviderName = name => name',
  '@deepseek-ai/dsh-experimental-browser-use-runtime': 'export class SessionResources {}',
  '@deepseek-ai/dsh-mcp-client': 'export const Config = value => value',
  '@deepseek-ai/dsh-scope': 'export const createScope = () => {}',
}
registerHooks({ resolve(specifier, context, next) {
  return stubs[specifier] ? { url: `data:text/javascript,${stubs[specifier]}`, shortCircuit: true } : next(specifier, context)
} })
const { SIDEBAR_BROWSER_ENV, serverLaunch, takeSidebarEndpoint } = await import('../lib/sidebar.js')

const endpoint = 'ws://127.0.0.1:4100/0123456789abcdef0123456789abcdef0123456789abcdef'
const agent = (origin) => ({ session: { id: 'session-0001', header: origin === undefined ? {} : { origin } } })
const browser = { mode: 'launch', headless: true, executablePath: '/synthetic/Electron', toolCallTimeoutMs: 120000 }

test('the desktop endpoint is taken once and leaves the environment', () => {
  const environment = { [SIDEBAR_BROWSER_ENV]: endpoint, PATH: '/bin' }
  assert.equal(takeSidebarEndpoint(environment), endpoint)
  assert.deepEqual(environment, { PATH: '/bin' })
  assert.equal(takeSidebarEndpoint(environment), undefined)
})

test('a conversation\'s own Agent attaches to its Sidebar without exposing the endpoint in arguments', () => {
  const { args, env } = serverLaunch(browser, agent(), endpoint, 'cli.js', { PLAYWRIGHT_MCP_HEADLESS: '1', PATH: '/bin' })
  assert.deepEqual(args, ['cli.js', '--browser', 'chromium'])
  assert.deepEqual(env, { PLAYWRIGHT_MCP_HEADLESS: '', PLAYWRIGHT_MCP_CDP_ENDPOINT: `${endpoint}/session-0001` })
})

test('subagents keep the isolated launched browser', () => {
  const { args, env } = serverLaunch(browser, agent('subagent'), endpoint, 'cli.js', { playwright_mcp_cdp_endpoint: 'ws://elsewhere' })
  assert.deepEqual(args, ['cli.js', '--browser', 'chromium', '--isolated', '--headless', '--executable-path', '/synthetic/Electron'])
  assert.deepEqual(env, { playwright_mcp_cdp_endpoint: '' })
  assert.deepEqual(serverLaunch({ ...browser, headless: false, executablePath: undefined }, agent('subagent'), endpoint, 'cli.js', {}).args,
    ['cli.js', '--browser', 'chromium', '--isolated'])
})
