import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const runtime = process.env.EDUWORK_TEST_RUNTIME
const root = fileURLToPath(new URL('../../', import.meta.url))
let dependencies
async function setup() {
  if (dependencies) return dependencies
  const require = createRequire(join(runtime, 'package.json'))
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
  let LocaleRuntime
  // Use the pinned upstream locale implementation, not a replacement translator.
  runInNewContext(await readFile(join(runtime, 'node_modules/@deepseek-ai/dsh-client-locale/lib/client.js'), 'utf8'), {
    console,
    window: { __ModuleLoader__: { load: definition => {
      LocaleRuntime = definition.factory(name => name.startsWith('react') ? require(name) : {}).LocaleRuntime
    } } },
  })
  async function load(relative, extraExports = '') {
    const path = join(root, relative)
    const { outputFiles } = await require('esbuild').build({
      stdin: { contents: await readFile(path, 'utf8') + '\n' + extraExports, resolveDir: dirname(path), loader: path.endsWith('tsx') ? 'tsx' : 'ts' },
      bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic',
      nodePaths: [process.env.EDUWORK_TEST_DEPENDENCIES, runtime].filter(Boolean).map(path => join(path, 'node_modules')),
      external: ['react', 'react-dom', '@deepseek-ai/*', '@eduwork/*'],
      plugins: [{ name: 'rpc-transport-fixture', setup(build) {
        build.onLoad({ filter: /[\\/]client[\\/]remote\.(?:js|ts)$/ }, () => ({ contents: 'export default {}; export const knowledgeStudioRemote = {}', loader: 'js' }))
      } }],
    })
    const module = { exports: {} }
    new Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports)
    return module.exports
  }
  dependencies = { React, renderToStaticMarkup, load, LocaleRuntime }
  return dependencies
}

for (const [pkg, namespace, key, chinese, english] of [
  ['dsh-oidc', 'NS', 'account.login', '使用企业账号登录', 'Sign in with organization'],
  ['dsh-mail', 'LOCALE_NS', 'nav', '邮件助手', 'Mail assistant'],
  ['dsh-knowledge-studio', 'NS', 'generate', '开始生成', 'Generate'],
]) test(`${pkg} follows the shared locale, including fallback and disposal`, { skip: !runtime }, async () => {
  const { load, LocaleRuntime } = await setup()
  const data = await load(`packages/${pkg}/src/client/locale.ts`)
  const locale = new LocaleRuntime({ emit() {} }, undefined, { languages: ['en-US'], preference: 'zh' })
  let revisions = 0
  const unsubscribe = locale.subscribe(() => revisions++)
  const dispose = locale.register(data[namespace], data.dictionaries)
  const t = locale.bind(data[namespace])
  assert.equal(t(key), chinese, 'the saved DSH choice overrides the browser language')
  assert.deepEqual(Object.keys(data.dictionaries.zh).sort(), Object.keys(data.dictionaries.en).sort())
  for (const value of Object.values(data.dictionaries.en)) assert.equal(typeof value, 'string')
  locale.setLocale('en')
  assert.equal(t(key), english, 'an already-bound translator observes live changes')
  locale.addLanguage({ id: 'fr', label: 'Français', fallback: 'en' })
  locale.setLocale('fr')
  assert.equal(t(key), english)
  locale.setLocale('zh')
  assert.equal(t(key), chinese)
  assert.ok(revisions >= 4)
  dispose(); unsubscribe()
  assert.equal(t(key), key)
})

test('account, mail and nested Studio surfaces render the active DSH language', { skip: !runtime }, async () => {
  const { React: R, renderToStaticMarkup: render, load, LocaleRuntime } = await setup()
  const locale = new LocaleRuntime({ emit() {} }, undefined, { languages: ['en'], preference: 'zh' })
  const oidc = await load('packages/dsh-oidc/src/client/index.ts', 'export { EnterpriseAccountCard }')
  const mail = await load('packages/dsh-mail/src/client/index.tsx', 'export { MailSettings }')
  const studio = await load('packages/dsh-knowledge-studio/src/client/index.tsx', 'export { ParameterDialog, ArtifactPanel, StudioLocale }')
  const namespaces = {}
  for (const pkg of ['dsh-oidc', 'dsh-mail', 'dsh-knowledge-studio']) {
    const data = await load(`packages/${pkg}/src/client/locale.ts`)
    namespaces[pkg] = data.NS ?? data.LOCALE_NS
    locale.register(namespaces[pkg], data.dictionaries)
  }
  const state = { state: 'signed_out' }
  const service = { accountSnapshot: () => state, subscribeAccounts: () => () => {} }
  const scopeSnapshot = { status: 'ready', writable: true, value: {} }
  const mailService = { scope: { getSnapshot: () => scopeSnapshot, subscribe: () => () => {} } }
  const profile = { id: 'example', displayName: 'Example', brand: {}, provider: { displayName: 'Example models', models: [] } }
  const draw = () => ({
    account: render(R.createElement(oidc.EnterpriseAccountCard, { service, configuration: { profiles: [profile] }, t: locale.bind(namespaces['dsh-oidc']) })),
    mail: render(R.createElement(mail.MailSettings, { service: mailService, t: locale.bind(namespaces['dsh-mail']) })),
    studio: render(R.createElement(studio.StudioLocale.Provider, { value: locale.bind(namespaces['dsh-knowledge-studio']) }, R.createElement(studio.ParameterDialog, { capability: { title: 'Example', parameters: [] }, close() {}, submit() {} }))),
  })
  const chinese = draw()
  assert.match(chinese.account, /使用企业账号登录/)
  assert.match(chinese.mail, /正在读取配置/)
  assert.match(chinese.studio, /开始生成/)
  assert.match(chinese.studio, /aria-label="关闭 Studio"/)
  locale.setLocale('en')
  const english = draw()
  assert.match(english.account, /Sign in with organization/)
  assert.match(english.mail, /Loading configuration/)
  assert.match(english.studio, /Generate/)
  assert.match(english.studio, /aria-label="Close Studio"/)
  profile.brand.loginButtonLabel = 'Institution sign-in'
  locale.setLocale('zh')
  assert.match(draw().account, /Institution sign-in/, 'publisher-provided wording is retained')
})
