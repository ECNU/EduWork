// Real components and installed theme tokens; synthetic settings only.
// EDUWORK_TEST_RUNTIME=/path/to/product/d node tests/settings-theme-browser.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ECNU_LIWA_TOKENS } from '../dsh-plugins/client-ui-branding/src/theme.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const runtime = process.env.EDUWORK_TEST_RUNTIME
assert.ok(runtime, 'Set EDUWORK_TEST_RUNTIME to an installed product/d directory')
const require = createRequire(join(runtime, 'package.json'))
const { build } = require('esbuild')
const { chromium } = require('playwright-core')
const theme = await readFile(join(runtime, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'), 'utf8')
const css = [...theme.matchAll(/"(?:[^"\\]|\\.)*"/g)].map(match => {
  try { return JSON.parse(match[0]) } catch { return '' }
}).find(text => text.includes('--dsw-alias-brand-primary:'))
assert.ok(css, 'Installed theme must expose its CSS tokens')
const components = [
  ['skills', 'dsh-plugins/workbench-native/src/client.ts', 'SkillCenter'],
  ['memory', 'packages/dsh-memory/src/client/index.ts', 'zh'],
  ['account', 'packages/dsh-oidc/src/client/index.ts', 'EnterpriseAccountCard'],
  ['provider', 'packages/dsh-oidc/src/client/managed-provider.ts', ''],
  ['activity', 'dsh-plugins/activity-insights-native/src/client/index.ts', 'Heatmap, zh'],
]
const scripts = new Map()
for (const [name, path, exports] of components) {
  const source = await readFile(join(root, path), 'utf8')
  const result = await build({
    stdin: { contents: `${source}\nexport { ${exports} }`, resolveDir: resolve(root, path, '..'), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: name, platform: 'browser',
    nodePaths: [join(runtime, 'node_modules')],
    plugins: [{ name: 'shared-react', setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shared-react' }))
      build.onLoad({ filter: /.*/, namespace: 'shared-react' }, () => ({ contents: 'module.exports = window.React' }))
    } }],
  })
  scripts.set(`/${name}.js`, result.outputFiles[0].text)
}
const fixture = `
const h=React.createElement;
function settings(value){let snapshot={status:'ready',writable:true,value};const listeners=new Set();return {
 getSnapshot:()=>snapshot,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)},
 set:async(k,v)=>{snapshot={...snapshot,value:{...snapshot.value,[k]:v}};listeners.forEach(f=>f())}
}}
const skillService={settings:settings({}),list:async()=>[
 {name:'artifact-documents',source:'builtin'}, {name:'artifact-images',source:'builtin'},
 {name:'personal-example',description:'用于检查个人技能的显示与移除。',source:'personal',removable:true}],
 subscribeSession:()=>()=>{},hasSession:()=>false};
const memoryService={settings:settings({enabled:true,search_prior_chats:true,disable_on_external_context:false}),stats:async()=>({total:1,suppressed:0}),listRecords:async()=>({total:1,offset:0,limit:10,items:[{id:'example',kind:'preference',content:'示例：回答保持简洁。',sources:[]}]})};
const status={state:'signed_out'};
const profile={id:'example',displayName:'示例学校',configured:true,builtIn:true,enabled:true,baseURL:'https://example.org',runtime:{models:[]}};
const accountService={status:async()=>status,accountSnapshot:()=>status,subscribeAccounts:()=>()=>{},management:async()=>({profiles:[profile],capabilities:{}})};
ReactDOM.createRoot(document.querySelector('#account')).render(h(account.EnterpriseAccountCard,{service:accountService,configuration:{profiles:[profile]}}));
ReactDOM.createRoot(document.querySelector('#provider')).render(h(provider.ManagedProviderCard,{service:accountService,configuration:{profiles:[profile]}}));
ReactDOM.createRoot(document.querySelector('#activity')).render(h(activity.Heatmap,{activity:Array.from({length:364},(_,i)=>({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),tokens:i%5*100,turns:i%5,toolCalls:0})),metric:'activity',setMetric:()=>{},t:k=>activity.zh[k]}));
ReactDOM.createRoot(document.querySelector('#skills')).render(h(skills.SkillCenter,{service:skillService}));
ReactDOM.createRoot(document.querySelector('#memory')).render(h(memory.MemorySection,{service:memoryService,t:k=>memory.zh[k]}));
`
const server = createServer(async (request, response) => {
  try {
    if (scripts.has(request.url)) { response.setHeader('Content-Type', 'text/javascript'); response.end(scripts.get(request.url)); return }
    if (request.url === '/react.js' || request.url === '/react-dom.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(await readFile(join(runtime, 'node_modules', request.url === '/react.js' ? 'react/umd/react.development.js' : 'react-dom/umd/react-dom.development.js')))
      return
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(`<html lang="zh"><meta charset="utf-8"><style>${css}
body{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:14px system-ui;margin:28px} main{max-width:820px;margin:auto} #memory{margin-top:40px} button,input,textarea{font:inherit} *{transition:none!important}</style>
<main><div id="skills"></div><div id="memory"></div></main><aside style="max-width:820px;margin:auto"><div id="account"></div><div id="provider"></div><div id="activity"></div></aside><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/skills.js"></script><script src="/memory.js"></script><script src="/account.js"></script><script src="/provider.js"></script><script src="/activity.js"></script><script>${fixture}</script></html>`)
  } catch (error) { response.statusCode = 500; response.end(error.message) }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
let browser
try {
  browser = await chromium.launch({ channel: process.env.EDUWORK_BROWSER_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 960, height: 1100 }, locale: 'zh-CN' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('switch', { name: 'Word 文档', exact: true }).waitFor()
  const output = process.env.EDUWORK_TEST_EVIDENCE
  if (output) await mkdir(output, { recursive: true })
  for (const palette of ['blue', 'red']) for (const mode of ['light', 'dark']) {
    await page.evaluate(({ palette, mode, tokens }) => {
      document.body.toggleAttribute('data-ds-dark-theme', mode === 'dark')
      document.body.style.colorScheme = mode
      for (const [key, value] of Object.entries(tokens)) {
        if (palette === 'red') document.body.style.setProperty(key, value[mode])
        else document.body.style.removeProperty(key)
      }
    }, { palette, mode, tokens: ECNU_LIWA_TOKENS })
    const contrast = await page.locator('#skills article p').first().evaluate(element => {
      const luminance = color => {
        const values = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        return values[0] * .2126 + values[1] * .7152 + values[2] * .0722
      }
      const fg = luminance(getComputedStyle(element).color), bg = luminance(getComputedStyle(element.closest('article')).backgroundColor)
      return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05)
    })
    assert.ok(contrast >= 4.5, `${palette}/${mode}: skill description contrast ${contrast}`)
    const toggle = page.getByRole('switch', { name: '启用本地 Memory', exact: true })
    const colors = () => toggle.evaluate(e => {
      const track = getComputedStyle(e).backgroundColor, thumb = getComputedStyle(e.firstElementChild).backgroundColor
      const luminance = color => {
        const v = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        return v[0] * .2126 + v[1] * .7152 + v[2] * .0722
      }
      const a = luminance(track), b = luminance(thumb)
      return { track, thumb, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
    })
    const on = await colors()
    assert.ok(on.contrast >= 3, `${palette}/${mode}: switch contrast ${on.contrast}`)
    await toggle.focus(); await page.keyboard.press('Space')
    await page.waitForFunction(() => document.querySelector('#memory [role=switch]').getAttribute('aria-checked') === 'false')
    assert.notEqual((await colors()).track, on.track, 'Off must differ from on')
    assert.equal(await page.getByRole('switch', { name: '允许检索过往对话', exact: true }).isDisabled(), true)
    await toggle.click()
    await page.getByRole('button', { name: '创建技能', exact: true }).click()
    const input = page.getByRole('dialog').getByRole('textbox', { name: '技能标识' })
    await input.fill('theme-check')
    assert.notEqual(await input.evaluate(e => getComputedStyle(e).color), await input.evaluate(e => getComputedStyle(e).backgroundColor))
    if (output) await page.screenshot({ path: join(output, `${palette}-${mode}-dialog.png`) })
    await page.getByRole('button', { name: '取消', exact: true }).click()
    if (output) await page.locator('main').screenshot({ path: join(output, `${palette}-${mode}.png`) })
    await page.getByRole('button', { name: '管理 Memory', exact: true }).click()
    const badge = page.getByRole('dialog').getByText('preference', { exact: true })
    await badge.waitFor()
    for (const element of [badge, page.locator('#activity button').first(), page.locator('#provider').getByText('已验证机构', { exact: true })]) {
      const matches = await element.evaluate(e => getComputedStyle(e).backgroundColor === (() => {
        const probe = document.createElement('span'); probe.style.background = e.closest('#activity') ? 'var(--dsw-alias-bg-layer-3)' : 'var(--dsw-alias-bg-layer-2)'; document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color
      })())
      assert.ok(matches, `${palette}/${mode}: badge/selected background follows theme`)
    }
    await page.getByRole('button', { name: '关闭记忆管理' }).click()
    const login = page.locator('#account').getByRole('button', { name: '使用企业账号登录' })
    const loginColors = await login.evaluate(e => ({ fg: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor }))
    assert.notEqual(loginColors.fg, loginColors.bg, 'Login button must not be white on white')
    if (output) await page.locator('aside').screenshot({ path: join(output, `${palette}-${mode}-related.png`) })
    console.log(`${palette}/${mode}: contrast ${contrast.toFixed(2)}, switch, editor, Memory badge, account and activity checks passed`)
  }
  assert.deepEqual(errors, [])
} finally { await browser?.close(); await new Promise(done => server.close(done)) }
