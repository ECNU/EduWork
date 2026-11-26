import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

// The tools run in DSH's own tool registry and executor, from the pinned
// Runtime the product uses (EDUWORK_TEST_RUNTIME), so their MCP calls take the
// path they take in the product; only Playwright MCP's tools are stand-ins.
const runtime = process.env.EDUWORK_TEST_RUNTIME
if (!runtime) throw new Error('Set EDUWORK_TEST_RUNTIME to the pinned DSH Runtime')
const fromRuntime = pathToFileURL(join(runtime, 'package.json')).href
const core = new URL('../../tool-browser/lib/core.js', import.meta.url).href
registerHooks({ resolve: (specifier, context, next) => specifier === '@chatecnu-work/dsh-tool-browser/core' ? { url: core, shortCircuit: true }
  : specifier.startsWith('@deepseek-ai/') ? next(specifier, { ...context, parentURL: fromRuntime }) : next(specifier, context) })
const { Context } = await import('@deepseek-ai/cordis')
const { defineTool } = await import('@deepseek-ai/dsh-tools')
const { ToolExecutionPipeline } = await import('@deepseek-ai/dsh-tools/pipeline')
const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
const dsh = await Promise.all(['@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-tool-executor-native'].map(async name => { const module = await import(name); return module.default ?? module }))
const { READ } = await import('../lib/page.js')
const { browserGuard, browserPermission } = await import('../lib/permission.js')
const { covered, noteSavedScreenshots, pageOf, registerPageTools } = await import('../lib/read-act.js')

const line = (text, top = 0) => ({ text, top })
const page = (url, title, lines, refs, extra = {}) => ({ url, title, alerts: [], lines, closed: [], refs, scrollY: 0, truncated: false, ...extra })
const site = () => ({
  search: page('https://library.example/', '馆藏检索', [line('# 馆藏检索'), line('[#1 textbox "检索词" empty] [#2 button "检索"]'), line('[#3 select "校区" = "全部", options "全部" "闵行"]'), line('[#5 link "内网通知"]')],
    { 1: { kind: 'textbox', name: '检索词' }, 2: { kind: 'button', name: '检索' }, 3: { kind: 'select', name: '校区' }, 4: { kind: 'link', name: '借阅规则', href: 'https://library.example/rules' },
      5: { kind: 'link', name: '内网通知', href: 'http://10.0.0.8/notice' } },
    { closed: [{ ref: 4, name: '借阅规则' }] }),
  results: page('https://library.example/?q=1', '检索结果', [line('[#1 link "深度学习入门"] 共 1 条 [#2 button "在线试读"]')],
    { 1: { kind: 'link', name: '深度学习入门', href: 'https://library.example/book/1', newTab: true }, 2: { kind: 'button', name: '在线试读' } }),
  book: page('https://library.example/book/1', '深度学习入门', [line('深度学习入门 馆藏：闵行')], {}),
  rules: page('https://library.example/rules', '借阅规则', [line('每人可借 20 册')], {}),
  notice: page('http://10.0.0.8/notice', '内网通知', [line('[#1 link "下一条"]')], { 1: { kind: 'link', name: '下一条', href: 'http://10.0.0.8/notice/2' } }),
})

// The Playwright MCP tools the page tools use, and their arguments.
const mcpTools = ['browser_evaluate', 'browser_navigate', 'browser_navigate_back', 'browser_tabs', 'browser_click', 'browser_type', 'browser_select_option',
  'browser_press_key', 'browser_wait_for', 'browser_take_screenshot']
const mcpArguments = Object.fromEntries([...['function', 'url', 'action', 'element', 'target', 'text', 'key', 'filename'].map(key => [key, { type: 'string' }]),
  ['index', { type: 'integer' }], ['time', { type: 'number' }], ['submit', { type: 'boolean' }], ['values', { type: 'array', items: { type: 'string' } }]])

// Tabs behind the Agent's Playwright MCP tools, answering browser_read's and
// browser_act's page scripts from the pages above. routes: what clicking a
// number does on a page, by page name, { newTab } for a page the page opens,
// 'error' for a click that fails and 'stop' for one during which the user
// stops the Agent. approve: the user's answer when the application asks.
async function harness({ start = 'search', routes = {}, suggests = false, approve = 'allowed-once' } = {}) {
  const pages = site()
  const tabs = [start]
  // outer: the browser_read or browser_act call running.
  let current = 0, used = false, outer
  const calls = [], asked = []
  const stop = new AbortController()
  const text = value => ({ content: [{ type: 'text', text: value }] })
  const go = key => { tabs[current] = key; return text(`### Ran Playwright code\n### Page\n- Page URL: ${pages[key].url}`) }
  const list = () => tabs.map((key, i) => `- ${i}: ${i === current ? '(current) ' : ''}[${pages[key].title}](${pages[key].url})`).join('\n')
  const ref = target => Number(/"(\d+)"/u.exec(target)?.[1])
  const answer = (name, args) => {
    const here = pages[tabs[current]]
    if (name === 'browser_evaluate' && args.function === READ) { used = false; return text(`### Result\n${JSON.stringify(here)}`) }
    if (name === 'browser_evaluate' && args.function.includes('went to another page')) {
      const url = JSON.parse(/location\.href !== ("[^"]*")/u.exec(args.function)[1])
      const next = /!same\(at\((\d+)\)\)/u.exec(args.function)?.[1]
      const answer = url !== here.url ? 'went to another page' : used && /true && \(document\["__eduworkInput"\]/u.test(args.function) ? 'the user used the page'
        : next && !here.refs[next] ? 'the page changed' : suggests && /at\(\d+\)\?\.getAttribute/u.test(args.function) ? 'suggestions opened under the field' : ''
      return text(`### Result\n${JSON.stringify(answer)}`)
    }
    if (name === 'browser_evaluate') return text('### Result\nundefined')
    if (name === 'browser_navigate') return go(Object.keys(pages).find(key => pages[key].url === args.url))
    if (name === 'browser_tabs') {
      if (args.action === 'select') current = args.index
      if (args.action === 'new') { tabs.push(Object.keys(pages).find(key => pages[key].url === args.url)); current = tabs.length - 1 }
      return text(`### Result\n${list()}`)
    }
    if (name === 'browser_take_screenshot') return text(`### Result\n- [Screenshot of viewport](./${args.filename ?? 'page.png'})`)
    // The Agent's own input counts in the page as the user's would.
    used = true
    const route = routes[tabs[current]]?.[ref(args.target)]
    if (route === 'error') throw new Error('### Error\nTimeoutError: locator.click: Timeout 5000ms exceeded.')
    if (route === 'stop') stop.abort()
    if (route?.newTab) { tabs.push(route.newTab); return text(`### Ran Playwright code\n### Open tabs\n${list()}`) }
    if (typeof route === 'string' && route in pages) return go(route)
    return text('### Ran Playwright code')
  }
  const agent = { session: {} }
  const ctx = new Context()
  for (const plugin of dsh) await ctx.plugin(plugin)
  for (const name of ['sandboxPolicy', 'workingDirectory', 'approval']) ctx.provide(name)
  ctx.set('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write' }) })
  ctx.set('workingDirectory', { get: session => { assert.equal(session, agent.session); return '/work/space' } })
  ctx.set('approval', { request: async request => { asked.push(request.toolName); return approve } })
  // MCP calls that do not go under the run making them, in its call tree.
  const strays = []
  // Registered under a condition, the MCP tools are found only through the tool set a model step admits.
  for (const name of mcpTools) {
    ctx.tools.register(defineTool({
      name: `mcp__playwright-mcp__${name}`, description: `Playwright MCP ${name}`, parameters: mcpArguments,
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => value.content },
      execute: (args, exec) => {
        const under = outer ? exec.parent === outer.token && covered.has(exec.parent) && exec.rootCallId === outer.rootCallId && exec.agent === outer.agent
          : exec.parent === undefined || covered.has(exec.parent)
        if (!under) strays.push(name)
        calls.push({ name, args })
        return answer(name, args)
      },
    }), { when: () => true })
  }
  // The plugin's own parts, as its apply installs them, without the MCP server and the Sidebar.
  ctx.tools.guard(exec => browserGuard(ctx, exec))
  ctx.on('tools/pre-execute', (exec, next) => browserPermission(ctx, exec, next))
  registerPageTools(ctx)
  noteSavedScreenshots(ctx)
  ctx.on('tools/execute', async (exec, next) => {
    if (!exec.name.startsWith('browser_')) return next()
    outer = exec
    try { return await next() } finally { outer = undefined }
  })
  let n = 0
  // A model step calling one tool: the batch's results.
  const step = async (tool, args) => {
    const toolSet = await ctx.tools.resolve({ agent, signal: stop.signal })
    const batch = await ctx.tools.execute({ calls: [{ id: `call${++n}`, name: tool, arguments: JSON.stringify(args) }], signal: stop.signal, agent, toolSet }).finally(() => toolSet.dispose())
    assert.deepEqual(strays, [], 'every MCP call of a run goes under its permission, in its call tree')
    return batch
  }
  // The tool's text, or its error thrown.
  const run = async (tool, args) => {
    const [{ result }] = (await step(tool, args)).results
    if (result.isError) throw new Error(result.error.message)
    return result.value
  }
  // An MCP tool the Agent calls itself in a step, or one a run calls under its token.
  const pipeline = new ToolExecutionPipeline(ctx)
  const direct = async (name, args = {}, parent) => {
    const toolSet = await ctx.tools.resolve({ agent, signal: stop.signal })
    const prepared = await pipeline.prepare({ callId: `call${++n}`, name: `mcp__playwright-mcp__${name}`, arguments: args, agent, signal: stop.signal, toolSet, ...parent && { parent } })
    return pipeline.complete(prepared.exec, prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared).finally(() => toolSet.dispose())
  }
  // The current tab shows another page, as when the user takes over.
  const visit = key => { tabs[current] = key }
  // The user's own input in the page, which its next read no longer counts.
  const use = () => { used = true }
  return { ctx, step, run, direct, visit, use, calls, asked, agent, pages, tabs: () => tabs.map(key => pages[key].url), current: () => current }
}

const actions = calls => calls.filter(c => !['browser_evaluate', 'browser_tabs'].includes(c.name))

test('browser_read opens an address and shows the page with its elements numbered', async () => {
  const browser = await harness()
  const text = await browser.run('browser_read', { url: 'https://library.example/' })
  assert.deepEqual(browser.calls.map(c => c.name), ['browser_navigate', 'browser_evaluate'])
  assert.match(text, /^<untrusted_web_content>\nPage: 馆藏检索\nURL: https:\/\/library\.example\/\n/u)
  assert.match(text, /\[#1 textbox "检索词" empty\] \[#2 button "检索"\]/u)
  assert.match(text, /In closed menus \(a click opens the address\): \[#4 link "借阅规则"\]/u)
  // newTab opens the address in a tab of its own.
  await browser.run('browser_read', { url: 'https://library.example/rules', newTab: true })
  assert.deepEqual(browser.tabs(), ['https://library.example/', 'https://library.example/rules'])
})

test('browser_act runs the actions in order on the numbered elements and shows the page after them', async () => {
  const browser = await harness({ routes: { search: { 2: 'results' } } })
  await browser.run('browser_read', {})
  const text = await browser.run('browser_act', { actions: [
    { do: 'type', ref: 1, text: '深度学习' }, { do: 'select', ref: 3, option: '闵行' }, { do: 'click', ref: 2 },
  ] })
  assert.deepEqual(actions(browser.calls), [
    { name: 'browser_type', args: { element: '检索词', target: '[data-eduwork-ref="1"]', text: '深度学习' } },
    { name: 'browser_select_option', args: { element: '校区', target: '[data-eduwork-ref="3"]', values: ['闵行'] } },
    { name: 'browser_click', args: { element: '检索', target: '[data-eduwork-ref="2"]' } },
  ])
  assert.match(text, /^1\. type "深度学习" into \[#1 textbox "检索词"\]: done\n2\. select "闵行" in \[#3 select "校区"\]: done\n3\. click \[#2 button "检索"\]: done\n/u)
  assert.match(text, /Page: 检索结果/u)
})

test('browser_act stops when the page moves on, and says what did not run', async () => {
  const browser = await harness({ routes: { search: { 1: 'results' } } })
  await browser.run('browser_read', {})
  const text = await browser.run('browser_act', { actions: [{ do: 'click', ref: 1 }, { do: 'type', ref: 1, text: '深度学习' }, { do: 'click', ref: 2 }] })
  assert.deepEqual(actions(browser.calls).map(c => c.name), ['browser_click'])
  assert.match(text, /^1\. click \[#1 textbox "检索词"\]: done, went to another page\n\(2 more not run\. Decide again from the page below\.\)/u)
  assert.match(text, /Page: 检索结果/u)
  // Typing that opens suggestions under the field stops the list too.
  const typed = await harness({ suggests: true })
  await typed.run('browser_read', {})
  assert.match(await typed.run('browser_act', { actions: [{ do: 'type', ref: 1, text: '深度' }, { do: 'click', ref: 2 }] }), /done, suggestions opened under the field\n\(1 more not run/u)
})

test('a link is opened by its address, in a new tab when it says so, and the Agent goes on in a tab the page opens', async () => {
  const browser = await harness({ start: 'results', routes: { results: { 2: { newTab: 'rules' } } } })
  await browser.run('browser_read', {})
  const text = await browser.run('browser_act', { actions: [{ do: 'click', ref: 1 }] })
  assert.deepEqual(browser.calls.filter(c => c.name === 'browser_tabs' && c.args.action !== 'list'), [{ name: 'browser_tabs', args: { action: 'new', url: 'https://library.example/book/1' } }])
  assert.match(text, /^1\. click \[#1 link "深度学习入门"\]: done, opened a new tab, now the current one/u)
  assert.match(text, /Page: 深度学习入门/u)
  assert.equal(browser.current(), 1)
  const popup = await harness({ start: 'results', routes: { results: { 2: { newTab: 'rules' } } } })
  await popup.run('browser_read', {})
  assert.match(await popup.run('browser_act', { actions: [{ do: 'click', ref: 2 }] }), /^1\. click \[#2 button "在线试读"\]: done, opened a new tab, now the current one[\s\S]*Page: 借阅规则/u)
  assert.equal(popup.current(), 1)
  // A link in a closed menu opens the same way, in the current tab.
  const menu = await harness()
  await menu.run('browser_read', {})
  assert.match(await menu.run('browser_act', { actions: [{ do: 'click', ref: 4 }] }), /Page: 借阅规则/u)
  assert.deepEqual(actions(menu.calls), [{ name: 'browser_navigate', args: { url: 'https://library.example/rules' } }])
})

test('browser_act checks the whole list before any of it runs, and reports a failure and a page that did not change', async () => {
  const browser = await harness({ routes: { search: { 2: 'error' } } })
  await assert.rejects(browser.run('browser_act', { actions: [{ do: 'click', ref: 2 }] }), /Read the page with browser_read first/u)
  await browser.run('browser_read', {})
  await assert.rejects(browser.run('browser_act', { actions: [{ do: 'type', ref: 1, text: 'x' }, { do: 'click', ref: 9 }] }), /no \[#9\]; nothing was done/u)
  await assert.rejects(browser.run('browser_act', { actions: [{ do: 'select', ref: 3 }] }), /needs option; nothing was done/u)
  assert.deepEqual(actions(browser.calls), [])
  const text = await browser.run('browser_act', { actions: [{ do: 'click', ref: 2 }, { do: 'click', ref: 1 }] })
  assert.match(text, /^1\. click \[#2 button "检索"\]: failed \(TimeoutError: locator\.click: Timeout 5000ms exceeded\.\)\n\(1 more not run/u)
  assert.match(text, /The page did not change\./u)
})

test('browser_act does nothing on a page that is not the one read any more', async () => {
  const browser = await harness()
  await browser.run('browser_read', {})
  browser.visit('results')
  const left = await browser.run('browser_act', { actions: [{ do: 'click', ref: 2 }] })
  assert.match(left, /^Nothing was done: since you read it, the page was left for another one\. Decide again from the page below\.\n\n<untrusted_web_content>\nPage: 检索结果/u)
  // The same page, without the element the action names.
  await browser.run('browser_read', {})
  delete browser.pages.results.refs[2]
  assert.match(await browser.run('browser_act', { actions: [{ do: 'click', ref: 2 }] }), /^Nothing was done: since you read it, the page changed\./u)
  // The same page, which the user used meanwhile, as to choose another option while the Agent asked them something.
  browser.pages.results.refs[2] = { kind: 'button', name: '在线试读' }
  await browser.run('browser_read', {})
  browser.use()
  assert.match(await browser.run('browser_act', { actions: [{ do: 'click', ref: 2 }] }), /^Nothing was done: since you read it, the user used the page\./u)
  assert.deepEqual(actions(browser.calls), [])
})

test('a browser tool the Agent calls itself that may move it, or a read that fails, leaves no page read', async () => {
  const browser = await harness()
  await browser.run('browser_read', {})
  // Looking keeps the page, and so do the calls of a run.
  await browser.direct('browser_take_screenshot')
  await browser.direct('browser_tabs', { action: 'list' })
  const token = Symbol('browser_act')
  covered.add(token)
  try { await browser.direct('browser_click', { target: '[data-eduwork-ref="2"]' }, token) } finally { covered.delete(token) }
  assert.equal(pageOf(browser.agent), 'https://library.example/')
  await browser.direct('browser_tabs', { action: 'select', index: 0 })
  assert.equal(pageOf(browser.agent), undefined)
  await assert.rejects(browser.run('browser_act', { actions: [{ do: 'click', ref: 2 }] }), /Read the page with browser_read first/u)
  await browser.run('browser_read', {})
  await assert.rejects(browser.run('browser_read', { url: 'https://library.example/missing' }))
  assert.equal(pageOf(browser.agent), undefined)
})

test('what appeared since the Agent last read the page is marked', async () => {
  const browser = await harness({ start: 'results' })
  await browser.run('browser_read', {})
  browser.pages.results.lines.push(line('[#3 button "加入书架"]'))
  browser.pages.results.refs[3] = { kind: 'button', name: '加入书架' }
  const text = await browser.run('browser_read', {})
  assert.match(text, /\[#1 link "深度学习入门"\] 共 1 条 \[#2 button "在线试读"\]\n\[#3\* button "加入书架"\]/u)
  // A page other than the one last read has nothing marked.
  assert.doesNotMatch(await browser.run('browser_read', { url: 'https://library.example/' }), /\*/u)
})

test('browser_act asks only for what the Agent marks for confirmation, and the application only for what it tells is risky', async () => {
  const context = mode => ({ sandboxPolicy: { resolve: () => ({ mode }) } })
  const allow = () => ({ kind: 'allow' })
  const browser = await harness()
  await browser.run('browser_read', {})
  const act = (actions, extra = {}, mode = 'workspace-write') => browserPermission(context(mode), { name: 'browser_act', agent: browser.agent, arguments: { actions, ...extra } }, allow)
  const form = [{ do: 'type', ref: 1, text: '深度学习', submit: true }, { do: 'scroll' }, { do: 'select', ref: 3, option: '闵行' }, { do: 'click', ref: 2 }, { do: 'press', key: 'Escape' }, { do: 'click', ref: 4 }]
  assert.equal(act(form).kind, 'allow')
  // The Agent's confirmation lists every step, a link as its click, and asks even under full access.
  const confirmed = act(form, { confirm: '在图书馆提交预约' }, 'danger-full-access')
  assert.equal(confirmed.kind, 'ask')
  assert.equal(confirmed.displayReason.zh, '请确认：在图书馆提交预约。智能体将在“检索词”中输入“深度学习”并提交；在“校区”中选择“闵行”；点击“检索”；按下 Escape 键；点击“借阅规则”')
  assert.equal(confirmed.reason, 'Confirm: 在图书馆提交预约. The Agent will type "深度学习" into "检索词" and submit it; select "闵行" in "校区"; click "检索"; press Escape; click "借阅规则"')
  // A link into a private network from another site asks as opening it does, in the Agent's confirmation too; its links among themselves do not.
  assert.equal(act([{ do: 'click', ref: 5 }]).displayReason.zh, '允许智能体打开本机或内网地址 http://10.0.0.8/notice')
  assert.equal(act([{ do: 'click', ref: 5 }], { confirm: '查看内网通知' }).displayReason.zh, '请确认：查看内网通知。智能体将点击“内网通知”。其中包括：打开本机或内网地址 http://10.0.0.8/notice')
  const read = url => browserPermission(context('workspace-write'), { name: 'browser_read', agent: browser.agent, arguments: { url } }, allow)
  assert.equal(read('https://library.example/').kind, 'allow')
  assert.equal(read(undefined).kind, 'allow')
  assert.equal(read('http://10.0.0.8/notice').kind, 'ask')
  // The application asks once, before the read: its own MCP calls do not ask again.
  await browser.run('browser_read', { url: 'http://10.0.0.8/notice' })
  assert.deepEqual(browser.asked, ['browser_read'])
  assert.equal(act([{ do: 'click', ref: 1 }]).kind, 'allow')
  // Only browser_act counts the page read as where it is, as it checks that before acting; an address typed in asks.
  assert.equal(read('http://10.0.0.8/notice/2').kind, 'ask')
  // Once the Agent leaves with a tool of its own, the network is entered from elsewhere again.
  await browser.direct('browser_navigate', { url: 'https://library.example/' })
  assert.equal(read('http://10.0.0.8/notice').kind, 'ask')
  // The MCP calls of a run go under its permission; a page script asked for directly asks.
  const token = Symbol('browser_act')
  covered.add(token)
  try { await browser.direct('browser_evaluate', { function: '() => 1' }, token) } finally { covered.delete(token) }
  assert.deepEqual(browser.asked, ['browser_read'])
  await browser.direct('browser_evaluate', { function: '() => 1' })
  assert.deepEqual(browser.asked, ['browser_read', 'mcp__playwright-mcp__browser_evaluate'])
})

test('what the user turns down does not run', async () => {
  const browser = await harness({ approve: 'rejected' })
  await assert.rejects(browser.run('browser_read', { url: 'http://10.0.0.8/notice' }), /rejected/u)
  assert.deepEqual([browser.asked, browser.calls], [['browser_read'], []])
})

test('what DSH hooks add for the model to a run\'s MCP calls comes with the run, a failed call\'s too', async () => {
  const browser = await harness({ routes: { search: { 2: 'error' } } })
  browser.ctx.on('tools/post-execute', async (exec, result, next) => exec.name.startsWith('mcp__')
    ? { ...await next(), additionalContexts: [createUserMessage({ content: [{ type: 'text', text: `after ${exec.name.replace('mcp__playwright-mcp__', '')}` }], source: 'synthetic-hook' })] }
    : next())
  const added = async (tool, args) => (await browser.step(tool, args)).additionalContexts.map(context => context.content[0].text)
  assert.deepEqual(await added('browser_read', {}), ['after browser_evaluate'])
  assert.deepEqual(await added('browser_act', { actions: [{ do: 'click', ref: 2 }] }), ['after browser_tabs', 'after browser_evaluate', 'after browser_click', 'after browser_evaluate'])
})

test('a run the user stops goes no further', async () => {
  const browser = await harness({ routes: { search: { 1: 'stop' } } })
  await browser.run('browser_read', {})
  const [{ result }] = (await browser.step('browser_act', { actions: [{ do: 'type', ref: 1, text: '深度学习' }, { do: 'click', ref: 2 }] })).results
  assert.equal(result.isError, true)
  assert.equal(browser.calls.at(-1).name, 'browser_type')
  assert.equal(covered.size, 0)
})

test('a screenshot saved under a name says where the image went', async () => {
  const browser = await harness()
  const texts = async (name, args) => (await browser.direct(name, args)).content.map(block => block.text)
  assert.deepEqual(await texts('browser_take_screenshot', { filename: 'shots/chart.png' }), ['### Result\n- [Screenshot of viewport](./shots/chart.png)', `The image is not in this result: it was saved as ${resolve('/work/space', 'shots/chart.png')}. To see it, open that path with read_image.`])
  // Without a name the image is in the result, and other tools are left alone.
  assert.deepEqual(await texts('browser_take_screenshot', {}), ['### Result\n- [Screenshot of viewport](./page.png)'])
  assert.deepEqual(await texts('browser_evaluate', { function: '() => 1', filename: 'page.md' }), ['### Result\nundefined'])
})
