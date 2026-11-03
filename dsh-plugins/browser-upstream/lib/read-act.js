// browser_read and browser_act: the Agent's view of a page and its way of
// acting on it. browser_read returns the page as text with its elements
// numbered (page.js). browser_act takes every action the Agent can decide from
// that page at once and runs them one after another through its own
// Playwright MCP tools, so in the desktop app the user watches each step in
// the Sidebar and the same browser rules apply. The list stops early when the
// page moves on, and the result shows the page as it is then: a page takes one
// model turn instead of one per action, and no snapshot file to read.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { READ, REF, fingerprint, render } from './page.js'

const mcp = name => `mcp__playwright-mcp__${name}`
// Moving around the page asks for no permission of its own.
export const QUIET = new Set(['scroll', 'wait'])
// The browser_read and browser_act runs whose MCP calls their own permission covers.
export const covered = new Set()
// The page each Agent last read, against which its numbers resolve.
const seenBy = new WeakMap()

const SCROLL = direction => `() => {
  const page = document.scrollingElement, from = page.scrollTop;
  page.scrollBy(0, ${direction} * innerHeight * 0.8);
  if (page.scrollTop !== from) return;
  // A page that scrolls inside a box of its own: the largest such box.
  const boxes = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 8 && /auto|scroll/.test(getComputedStyle(e).overflowY));
  boxes.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]?.scrollBy(0, ${direction} * innerHeight * 0.8);
}`

/** The MCP call that carries out one action on an element the Agent read. */
export function callFor(action, element = {}) {
  const at = { element: element.name, target: `[${REF}="${action.ref}"]` }
  switch (action.do) {
    // A link that loads another page is opened by its address, as browser_read
    // opens one: none of the page's own click handlers run, and a link in a
    // closed menu opens too.
    case 'click':
      if (element.href === undefined) return { name: 'browser_click', arguments: at }
      return element.newTab ? { name: 'browser_tabs', arguments: { action: 'new', url: element.href } } : { name: 'browser_navigate', arguments: { url: element.href } }
    case 'type': return { name: 'browser_type', arguments: { ...at, text: action.text, ...action.submit && { submit: true } } }
    case 'select': return { name: 'browser_select_option', arguments: { ...at, values: [action.option] } }
    case 'press': return { name: 'browser_press_key', arguments: { key: action.key } }
    case 'scroll': return { name: 'browser_evaluate', arguments: { function: SCROLL(action.direction === 'up' ? -1 : 1) } }
    case 'back': return { name: 'browser_navigate_back', arguments: {} }
    case 'wait': return { name: 'browser_wait_for', arguments: { time: Math.min(Math.max(action.seconds ?? 1, 0.1), 10) } }
  }
}

/** The element an Agent's action names, as the page it last read showed it. */
export const elementOf = (agent, ref) => seenBy.get(agent)?.refs[ref]

const needs = { click: ['ref'], type: ['ref', 'text'], select: ['ref', 'option'], press: ['key'] }
function check(actions, seen) {
  if (!actions.length) throw new Error('List at least one action.')
  for (const [i, action] of actions.entries()) {
    const missing = (needs[action.do] ?? []).filter(field => action[field] === undefined)
    if (missing.length) throw new Error(`Action ${i + 1} (${action.do}) needs ${missing.join(' and ')}; nothing was done.`)
    if (action.ref !== undefined && needs[action.do]?.includes('ref') && !seen.refs[action.ref]) throw new Error(`Action ${i + 1}: the page you read has no [#${action.ref}]; nothing was done. Read the page again.`)
  }
}

const said = (action, element) => {
  const at = element && `[#${action.ref} ${element.kind} "${element.name}"]`
  switch (action.do) {
    case 'click': return `click ${at}`
    case 'type': return `type "${action.text}" into ${at}${action.submit ? ' and submit' : ''}`
    case 'select': return `select "${action.option}" in ${at}`
    case 'press': return `press ${action.key}`
    case 'scroll': return `scroll ${action.direction === 'up' ? 'up' : 'down'}`
    case 'back': return 'go back'
    case 'wait': return `wait ${action.seconds ?? 1} s`
  }
}

// Before the next action: whether the page is still the one read, after a
// moment for a navigation the last action set off to begin, as a form that
// submits itself when an option is chosen does; whether the next action's
// element is still there; and whether typing opened suggestions.
const STILL = (url, next, typed) => `async () => {
  await new Promise(resolve => setTimeout(resolve, 120));
  const at = ref => document.querySelector('[${REF}="' + ref + '"]');
  if (location.href !== ${JSON.stringify(url)} || document.readyState === 'loading') return 'went to another page';
  if (${next === undefined ? 'false' : `!at(${next})`}) return 'the page changed';
  if (${typed === undefined ? 'false' : `at(${typed})?.getAttribute('aria-expanded') === 'true'`}) return 'suggestions opened under the field';
  return '';
}`

// How many tabs a tools response lists, when it lists them.
const tabCount = text => /### (?:Open tabs|Result)\n((?:- \d+: .*(?:\n|$))+)/u.exec(text)?.[1].trim().split('\n').length
const firstLine = message => message.split('\n').find(line => line.trim() && !line.startsWith('###')) ?? message
const untrusted = text => `<untrusted_web_content>\n${text}\n</untrusted_web_content>`

function runner(ctx, exec) {
  let calls = 0
  return async (name, input) => {
    const result = await ctx.tools.execute({
      callId: `${exec.callId}:${++calls}`, rootCallId: exec.rootCallId, name: mcp(name), arguments: input,
      agent: exec.agent, parent: exec.token, signal: exec.signal,
    })
    if (result.isError) throw new Error(result.error.message)
    return result.value.content.map(block => block.text ?? '').join('\n')
  }
}

async function look(run) {
  const evaluate = async () => JSON.parse(/### Result\n([\s\S]*?)(?:\n### |$)/u.exec(await run('browser_evaluate', { function: READ }))[1])
  // A page still navigating cannot be read yet.
  return evaluate().catch(async () => { await run('browser_wait_for', { time: 1 }); return evaluate() })
}

// The page as the Agent reads it, with what appeared since it last read this one marked.
function view(agent, seen, find) {
  const before = seenBy.get(agent)
  const key = element => `${element.kind} ${element.name}`
  const known = new Set(before?.url === seen.url ? Object.values(before.refs).map(key) : [])
  const fresh = new Set(known.size ? Object.entries(seen.refs).filter(([, element]) => !known.has(key(element))).map(([ref]) => Number(ref)) : [])
  seenBy.set(agent, seen)
  return untrusted(render(seen, { find, fresh }))
}

async function act(run, agent, actions) {
  const seen = seenBy.get(agent)
  if (!seen) throw new Error('Read the page with browser_read first; browser_act uses the numbers it shows.')
  check(actions, seen)
  let tabs = tabCount(await run('browser_tabs', { action: 'list' })) ?? 1
  const report = []
  for (const [i, action] of actions.entries()) {
    const element = seen.refs[action.ref]
    const call = callFor(action, element)
    let text
    try { text = await run(call.name, call.arguments) } catch (error) {
      report.push(`${i + 1}. ${said(action, element)}: failed (${firstLine(error.message)})`)
      break
    }
    // Whatever comes next was decided on a page that is no longer there.
    let moved
    // The Agent goes on in a new tab, whether a link opened it, which makes
    // it the current one, or the page did.
    const count = tabCount(text) ?? tabs
    if (count > tabs) {
      if (call.name !== 'browser_tabs') await run('browser_tabs', { action: 'select', index: count - 1 })
      tabs = count
      moved = 'opened a new tab, now the current one'
    }
    if (!moved && text.includes('### Modal state')) moved = 'a dialog or file chooser opened'
    if (!moved && i < actions.length - 1) {
      const next = actions[i + 1]
      const still = STILL(seen.url, needs[next.do]?.includes('ref') ? next.ref : undefined, action.do === 'type' ? action.ref : undefined)
      // A page that navigates away while asked has moved on too.
      moved = await run('browser_evaluate', { function: still }).then(answer => JSON.parse(/### Result\n(.*)/u.exec(answer)[1]), () => 'went to another page')
    }
    report.push(`${i + 1}. ${said(action, element)}: done${moved ? `, ${moved}` : ''}`)
    if (moved) break
  }
  const left = actions.length - report.length
  if (left) report.push(`(${left} more not run. Decide again from the page below.)`)
  // What ran is reported even when the page cannot be read afterwards.
  const after = await look(run).catch(error => error)
  if (after instanceof Error) return `${report.join('\n')}\n\nThe page could not be read: ${firstLine(after.message)}`
  if (fingerprint(after) === fingerprint(seen)) report.push('The page did not change.')
  return `${report.join('\n')}\n\n${view(agent, after)}`
}

const page = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }

export function registerPageTools(ctx) {
  // Each run's MCP calls go under its own permission while it lasts.
  const within = async (exec, work) => {
    covered.add(exec.token)
    try { return await work(runner(ctx, exec)) } finally { covered.delete(exec.token) }
  }
  ctx.tools.register(defineTool({
    name: 'browser_read',
    description: 'Read the current browser page as text: what it says, and every link, button and field the user can use now, written in brackets with a number, for example [#12 button "搜索"] or [#9 textbox "检索词" empty]. A * after the number marks what appeared since you last read this page. Pass url to open an address first, with newTab to open it in a new tab. Long pages show the part around the scroll position; scroll with browser_act or pass find to list just the lines with any of its words. Act on the page with browser_act, by those numbers.',
    parameters: {
      url: { type: 'string', description: 'Address to open before reading: one the user gave or one you are sure of. To open a link on the page you read, click it with browser_act, which opens its exact address. Omit to read the current page.' },
      newTab: { type: 'boolean', description: 'Open url in a new tab instead of the current one.' },
      find: { type: 'string', description: 'Words to look for; only the lines containing one of them are listed.' },
    },
    output: page,
    timeoutMs: 60_000,
    presentCall: args => ({ card: 'generic', title: args.url ? `浏览器 · 打开 ${args.url}` : '浏览器 · 读取页面', kind: 'read' }),
    execute: (args, exec) => within(exec, async run => {
      if (args.url !== undefined) await (args.newTab ? run('browser_tabs', { action: 'new', url: args.url }) : run('browser_navigate', { url: args.url }))
      return view(exec.agent, await look(run), args.find)
    }),
  }))
  ctx.tools.register(defineTool({
    name: 'browser_act',
    description: 'Act on the page you last read with browser_read, by the numbers it showed. Put every action you can already decide from that page in one call, in order: for example type a search term and click Search, or fill in a whole form, choose its options and submit it. Clicking checks or unchecks a box or switch. They run one after another and stop early when the page moves on (another address or tab, a dialog, or suggestions opening under a field you typed in); the result says what ran and shows the page as it is then. When it shows what the user asked for, such as a success message or the answer, stop there and answer. Use the other browser tools for tabs, screenshots, uploads and page dialogs.',
    parameters: {
      actions: {
        type: 'array', required: true, description: 'The actions, in order.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            do: { type: 'string', required: true, enum: ['click', 'type', 'select', 'press', 'scroll', 'back', 'wait'], description: 'click an element; type text into a field; select an option of a dropdown; press a key; scroll the page; go back; wait for the page.' },
            ref: { type: 'integer', description: 'The element\'s number from the page, for click, type and select.' },
            text: { type: 'string', description: 'For type: the text, which replaces what the field holds.' },
            submit: { type: 'boolean', description: 'For type: press Enter after typing.' },
            option: { type: 'string', description: 'For select: the option as shown.' },
            key: { type: 'string', description: 'For press: a key such as Enter, Escape or ArrowDown.' },
            direction: { type: 'string', enum: ['down', 'up'], description: 'For scroll; down by default.' },
            seconds: { type: 'number', description: 'For wait; 1 by default, at most 10.' },
          },
        },
      },
    },
    output: page,
    timeoutMs: 120_000,
    presentCall: args => ({ card: 'generic', title: `浏览器 · 操作页面（${args.actions?.length ?? 0} 步）`, kind: 'execute' }),
    execute: (args, exec) => within(exec, run => act(run, exec.agent, args.actions)),
  }))
}
