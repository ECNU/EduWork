import assert from 'node:assert/strict'
import test from 'node:test'
import { READ } from '../lib/page.js'
import { browserPermission } from '../lib/permission.js'
import { covered, registerPageTools } from '../lib/read-act.js'

const line = (text, top = 0) => ({ text, top })
const page = (url, title, lines, refs, extra = {}) => ({ url, title, alerts: [], lines, closed: [], refs, scrollY: 0, truncated: false, ...extra })
const site = () => ({
  search: page('https://library.example/', '馆藏检索', [line('# 馆藏检索'), line('[#1 textbox "检索词" empty] [#2 button "检索"]'), line('[#3 select "校区" = "全部", options "全部" "闵行"]')],
    { 1: { kind: 'textbox', name: '检索词' }, 2: { kind: 'button', name: '检索' }, 3: { kind: 'select', name: '校区' }, 4: { kind: 'link', name: '借阅规则', href: 'https://library.example/rules', hidden: true } },
    { closed: [{ ref: 4, name: '借阅规则' }] }),
  results: page('https://library.example/?q=1', '检索结果', [line('[#1 link "深度学习入门"] 共 1 条')], { 1: { kind: 'link', name: '深度学习入门', href: 'https://library.example/book/1', newTab: true } }),
  book: page('https://library.example/book/1', '深度学习入门', [line('深度学习入门 馆藏：闵行')], {}),
  rules: page('https://library.example/rules', '借阅规则', [line('每人可借 20 册')], {}),
})

// Tabs behind the Agent's Playwright MCP tools, answering browser_read's and
// browser_act's page scripts from the pages above. routes: what clicking a
// number does on a page, by page name. A new tab shows up in the tab list
// only after `late` more lists.
function harness({ start = 'search', routes = {}, late = 0, suggests = false } = {}) {
  const pages = site()
  const tabs = [start]
  let current = 0, pending
  const calls = []
  const tools = {}
  const text = value => ({ isError: false, value: { content: [{ type: 'text', text: value }] } })
  const go = key => { tabs[current] = key; return text(`### Ran Playwright code\n### Page\n- Page URL: ${pages[key].url}`) }
  const ref = target => Number(/"(\d+)"/u.exec(target)?.[1])
  const ctx = {
    tools: {
      register: definition => { tools[definition.name] = definition },
      async execute(exec) {
        assert.ok(covered.has(exec.parent), 'every MCP call runs under its tool\'s permission')
        const name = exec.name.replace('mcp__playwright-mcp__', ''), args = exec.arguments
        calls.push({ name, args })
        const here = pages[tabs[current]]
        if (name === 'browser_evaluate' && args.function === READ) return text(`### Result\n${JSON.stringify(here)}`)
        if (name === 'browser_evaluate' && args.function.includes('went to another page')) {
          const url = JSON.parse(/location\.href !== ("[^"]*")/u.exec(args.function)[1])
          const next = /!at\((\d+)\)/u.exec(args.function)?.[1]
          const answer = url !== here.url ? 'went to another page' : next && !here.refs[next] ? 'the page changed' : suggests && /at\(\d+\)\?\.getAttribute/u.test(args.function) ? 'suggestions opened under the field' : ''
          return text(`### Result\n${JSON.stringify(answer)}`)
        }
        if (name === 'browser_evaluate') return text('### Result\nundefined')
        if (name === 'browser_navigate') return go(Object.keys(pages).find(key => pages[key].url === args.url))
        if (name === 'browser_tabs') {
          if (args.action === 'select') current = args.index
          if (args.action === 'new') { tabs.push(Object.keys(pages).find(key => pages[key].url === args.url)); current = tabs.length - 1 }
          if (args.action === 'list' && pending && !late--) { tabs.push(pending); pending = undefined }
          return text(`### Result\n${tabs.map((key, i) => `- ${i}: ${i === current ? '(current) ' : ''}[${pages[key].title}](${pages[key].url})`).join('\n')}`)
        }
        const route = routes[tabs[current]]?.[ref(args.target)]
        if (route === 'error') return { isError: true, error: { message: '### Error\nTimeoutError: locator.click: Timeout 5000ms exceeded.' } }
        if (route?.newTab) { pending = route.newTab; return text('### Ran Playwright code') }
        if (route) return go(route)
        return text('### Ran Playwright code')
      },
    },
  }
  registerPageTools(ctx)
  const agent = { session: {} }
  let n = 0
  const run = (tool, args) => tools[tool].execute(args, { callId: `call${++n}`, rootCallId: `call${n}`, token: Symbol(`call${n}`), agent, signal: new AbortController().signal })
  return { run, calls, agent, pages, tabs: () => tabs.map(key => pages[key].url), current: () => current }
}

const actions = calls => calls.filter(c => !['browser_evaluate', 'browser_tabs'].includes(c.name))

test('browser_read opens an address and shows the page with its elements numbered', async () => {
  const browser = harness()
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
  const browser = harness({ routes: { search: { 2: 'results' } } })
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
  const browser = harness({ routes: { search: { 1: 'results' } } })
  await browser.run('browser_read', {})
  const text = await browser.run('browser_act', { actions: [{ do: 'click', ref: 1 }, { do: 'type', ref: 1, text: '深度学习' }, { do: 'click', ref: 2 }] })
  assert.deepEqual(actions(browser.calls).map(c => c.name), ['browser_click'])
  assert.match(text, /^1\. click \[#1 textbox "检索词"\]: done, went to another page\n\(2 more not run\. Decide again from the page below\.\)/u)
  assert.match(text, /Page: 检索结果/u)
  // Typing that opens suggestions under the field stops the list too.
  const typed = harness({ suggests: true })
  await typed.run('browser_read', {})
  assert.match(await typed.run('browser_act', { actions: [{ do: 'type', ref: 1, text: '深度' }, { do: 'click', ref: 2 }] }), /done, suggestions opened under the field\n\(1 more not run/u)
})

test('a link that opens a new tab is followed there, even when the tab shows up late', async () => {
  const browser = harness({ start: 'results', routes: { results: { 1: { newTab: 'book' } } }, late: 1 })
  await browser.run('browser_read', {})
  const text = await browser.run('browser_act', { actions: [{ do: 'click', ref: 1 }] })
  assert.match(text, /^1\. click \[#1 link "深度学习入门"\]: done, opened a new tab, now the current one/u)
  assert.match(text, /Page: 深度学习入门/u)
  assert.equal(browser.current(), 1)
})

test('a link in a closed menu is opened by its address', async () => {
  const browser = harness()
  await browser.run('browser_read', {})
  const text = await browser.run('browser_act', { actions: [{ do: 'click', ref: 4 }] })
  assert.deepEqual(actions(browser.calls), [{ name: 'browser_navigate', args: { url: 'https://library.example/rules' } }])
  assert.match(text, /Page: 借阅规则/u)
})

test('browser_act checks the whole list before any of it runs, and reports a failure and a page that did not change', async () => {
  const browser = harness({ routes: { search: { 2: 'error' } } })
  await assert.rejects(browser.run('browser_act', { actions: [{ do: 'click', ref: 2 }] }), /Read the page with browser_read first/u)
  await browser.run('browser_read', {})
  await assert.rejects(browser.run('browser_act', { actions: [{ do: 'type', ref: 1, text: 'x' }, { do: 'click', ref: 9 }] }), /no \[#9\]; nothing was done/u)
  await assert.rejects(browser.run('browser_act', { actions: [{ do: 'select', ref: 3 }] }), /needs option; nothing was done/u)
  assert.deepEqual(actions(browser.calls), [])
  const text = await browser.run('browser_act', { actions: [{ do: 'click', ref: 2 }, { do: 'click', ref: 1 }] })
  assert.match(text, /^1\. click \[#2 button "检索"\]: failed \(TimeoutError: locator\.click: Timeout 5000ms exceeded\.\)\n\(1 more not run/u)
  assert.match(text, /The page did not change\./u)
})

test('what appeared since the Agent last read the page is marked', async () => {
  const browser = harness({ start: 'results' })
  await browser.run('browser_read', {})
  browser.pages.results.lines.push(line('[#2 button "加入书架"]'))
  browser.pages.results.refs[2] = { kind: 'button', name: '加入书架' }
  const text = await browser.run('browser_read', {})
  assert.match(text, /\[#1 link "深度学习入门"\] 共 1 条\n\[#2\* button "加入书架"\]/u)
  // A page other than the one last read has nothing marked.
  assert.doesNotMatch(await browser.run('browser_read', { url: 'https://library.example/' }), /\*/u)
})

test('browser_act asks once for everything it will do; moving around and nested calls do not ask', async () => {
  const context = { sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) } }
  const allow = () => ({ kind: 'allow' })
  const browser = harness()
  await browser.run('browser_read', {})
  const ask = actions => browserPermission(context, { name: 'browser_act', agent: browser.agent, arguments: { actions } }, allow)
  const decision = ask([{ do: 'type', ref: 1, text: '深度学习', submit: true }, { do: 'scroll' }, { do: 'select', ref: 3, option: '闵行' }, { do: 'click', ref: 2 }, { do: 'press', key: 'Escape' }])
  assert.equal(decision.kind, 'ask')
  assert.equal(decision.displayReason.zh, '允许智能体在“检索词”中输入“深度学习”并提交；在“校区”中选择“闵行”；点击“检索”；按下 Escape 键')
  assert.equal(decision.reason, 'Allow the Agent to type "深度学习" into "检索词" and submit it; select "闵行" in "校区"; click "检索"; press Escape')
  assert.equal(ask([{ do: 'scroll', direction: 'down' }, { do: 'wait', seconds: 2 }]).kind, 'allow')
  // A public link in a closed menu opens like any public address.
  assert.equal(ask([{ do: 'click', ref: 4 }]).kind, 'allow')
  assert.equal(browserPermission({ sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) } }, { name: 'browser_act', agent: browser.agent, arguments: { actions: [{ do: 'click', ref: 2 }] } }, allow).kind, 'allow')
  const read = url => browserPermission(context, { name: 'browser_read', agent: browser.agent, arguments: { url } }, allow)
  assert.equal(read('https://library.example/').kind, 'allow')
  assert.equal(read(undefined).kind, 'allow')
  assert.equal(read('http://127.0.0.1:8080/').displayReason.zh, '允许智能体打开本机或内网地址 http://127.0.0.1:8080/')
  const token = Symbol('browser_act')
  covered.add(token)
  try {
    assert.equal(browserPermission(context, { name: 'mcp__playwright-mcp__browser_click', agent: browser.agent, parent: token, arguments: {} }, allow).kind, 'allow')
  } finally { covered.delete(token) }
  assert.equal(browserPermission(context, { name: 'mcp__playwright-mcp__browser_click', agent: browser.agent, parent: token, arguments: {} }, allow).kind, 'ask')
})
