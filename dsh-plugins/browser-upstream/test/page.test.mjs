// render() on its own, and the page script in a real browser when
// EDUWORK_TEST_RUNTIME (pinned Runtime with playwright-core) and
// DSH_MEDIA_BROWSER (a Chromium executable) are set.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { READ, REF, STILL, render } from '../lib/page.js'

const lines = (...texts) => texts.map((text, i) => ({ text, top: i * 100 }))
const seen = extra => ({ url: 'https://campus.example/', title: '校园', alerts: [], lines: lines('第一行', '第二行 [#1 link "通知"]', '第三行'), closed: [], refs: {}, scrollY: 0, truncated: false, ...extra })

test('render shows the page from the scroll position within the budget, and says what it leaves out', () => {
  assert.equal(render(seen()), 'Page: 校园\nURL: https://campus.example/\n\n第一行\n第二行 [#1 link "通知"]\n第三行')
  // Scrolled to the second line, with room for two lines: the one before stays out.
  assert.equal(render(seen({ scrollY: 100 }), { budget: 25 }).split('\n\n')[1],
    '(4 characters above, not shown: scroll up, or read with find.)\n第二行 [#1 link "通知"]\n第三行')
  assert.match(render(seen(), { budget: 12 }), /第一行\n\(23 characters below, not shown: scroll down, or read with find\.\)$/u)
  // Room left over below is filled with what comes before.
  assert.match(render(seen({ scrollY: 200 })), /\n\n第一行\n第二行/u)
})

test('render lists the lines with the words asked for, marks new elements, and names dialogs, messages and closed menus', () => {
  assert.equal(render(seen(), { find: '通知' }).split('\n\n')[1], '第二行 [#1 link "通知"]\n第三行')
  assert.match(render(seen(), { find: '成绩' }), /No line on the page contains 成绩\./u)
  assert.match(render(seen(), { fresh: new Set([1]) }), /\[#1\* link "通知"\]/u)
  const shown = render(seen({ dialog: '确认提交', alerts: ['已保存'], closed: [{ ref: 7, name: '学校概况' }] }))
  assert.match(shown, /^Page: 校园\nURL: https:\/\/campus\.example\/\nA dialog is open \("确认提交"\); only the dialog is shown\.\nMessages: 已保存\n/u)
  assert.match(shown, /\n\nIn closed menus \(a click opens the address\): \[#7 link "学校概况"\]$/u)
})

const runtime = process.env.EDUWORK_TEST_RUNTIME, chromium = process.env.DSH_MEDIA_BROWSER
const PAGE = `<!doctype html><meta charset="utf-8"><title>报名</title>
<style>.menu { height: 0; overflow: hidden } .slid { position: fixed; left: -500px; width: 300px } .box { display: block } .float { float: left }
  .custom input { opacity: 0; position: absolute; width: 1px; height: 1px } #overlay { position: fixed; inset: 0; background: #fff8 }</style>
<nav class="menu"><a href="https://campus.example/about">学校概况</a></nav>
<nav class="slid"><a href="https://campus.example/news">新闻</a></nav>
<h1>活动报名</h1>
<ul><li><a href="https://campus.example/n/1"><img src="data:," width="40" height="40"></a><a href="https://campus.example/n/1">讲座通知</a> 2026-11-03</li>
  <li><a href="https://campus.example/n/2"><div class="box">工作坊报名开始</div><div class="box">报名截止到 11 月 8 日，名额有限，先到先得，请尽快报名参加本次工作坊活动。</div><div class="box">2026-11-02</div></a></li>
  <li><a href="https://campus.example/n/3"><span class="float">校园风光</span></a></li></ul>
<table><tr><td>上午场</td><td>9:00</td></tr></table>
<div><canvas width="300" height="150" aria-label="报名人数"></canvas><svg width="16" height="16"><circle r="8"/></svg></div>
<label for="name">姓名</label><input id="name" required>
<div><span>学号</span><input id="sid" value="20261234" maxlength="11"></div>
<label>密码 <input type="password" value="Synthetic-Pass-1"></label>
<label class="custom"><input type="checkbox">同意活动须知</label>
<select aria-label="场次"><option>上午</option><option selected>下午</option></select>
<button disabled>提交</button> <a href="#top">回到顶部</a>
<p><label>人数 <input type="number" min="2" max="8"></label> <label>日期 <input type="date"></label></p>
<div><span>可选</span><input aria-label="邮箱地址"></div>
<div><p>请填写学校发放的十一位学号，不要填写身份证号码或手机号。</p><input placeholder="学号"></div>
<div id="host"></div><script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<button>影子按钮</button>'</script>`

test('the page script reads what the user sees, numbers what can be used, points out drawings, and never shows a password', { skip: !(runtime && chromium) }, async () => {
  const { chromium: launcher } = createRequire(join(runtime, 'package.json'))('playwright-core')
  const browser = await launcher.launch({ executablePath: chromium, headless: true })
  try {
    const page = await (await browser.newContext({ viewport: { width: 576, height: 744 } })).newPage()
    await page.route('https://campus.example/signup', route => route.fulfill({ contentType: 'text/html', body: PAGE }))
    await page.goto('https://campus.example/signup')
    const read = async () => page.evaluate(`(${READ})()`)
    const first = await read()
    const text = render(first)
    assert.ok(!text.includes('Synthetic-Pass-1'))
    assert.deepEqual(text.split('\n\n')[1].split('\n'), [
      '# 活动报名',
      '- [#3 link "讲座通知"] 2026-11-03',
      '- [#4 link: 工作坊报名开始 报名截止到 11 月 8 日，名额有限，先到先得，请尽快报名参加本次工作坊活动。 2026-11-02]',
      '- [#5 link "校园风光"]',
      '上午场 | 9:00',
      '[drawing "报名人数", not read: to see it, take a screenshot without a filename]',
      '[#6 textbox "姓名" empty, required]',
      '学号 [#7 textbox "学号" = "20261234", at most 11 characters]',
      '[#8 textbox "密码" filled] [#9 checkbox "同意活动须知" not checked] [#10 select "场次" = "下午", options "上午" "下午"] [button "提交" disabled] [#11 link "回到顶部"]',
      '[#12 textbox "人数" empty, number 2–8] [#13 textbox "日期" empty, date]',
      // The name the page gives a field comes first; a caption too long to be one is passed over.
      '可选 [#14 textbox "邮箱地址" empty]',
      '请填写学校发放的十一位学号，不要填写身份证号码或手机号。',
      '[#15 textbox "学号" empty]',
      '[#16 button "影子按钮"]',
    ])
    // browser_act's check finds numbered elements in shadow roots too.
    const still = async options => page.evaluate(`(${STILL(first, options)})()`)
    assert.equal(await still({ next: 16, settle: false }), '')
    assert.equal(await still({ next: 99, settle: false }), 'the page changed')
    // What a field holds may change; a control the page puts to another use is not the one read.
    await page.locator(`[${REF}="6"]`).fill('李华')
    assert.equal(await still({ next: 6, settle: false }), '')
    await page.evaluate(() => { document.querySelector('a[href="#top"]').textContent = '删除草稿' })
    assert.equal(await still({ next: 11, settle: false }), 'the page changed')
    await page.evaluate(() => { document.querySelector('a[href="#top"]').textContent = '回到顶部' })
    // A link that loads another page carries the address that opens it; one within the page is clicked.
    assert.equal(first.refs[3].href, 'https://campus.example/n/1')
    assert.equal(first.refs[11].href, undefined)
    assert.match(text, /In closed menus \(a click opens the address\): \[#1 link "学校概况"\] \[#2 link "新闻"\]$/u)
    // The number marks what takes the click: the label in front of a hidden box, and in a link with no box of its own, as one around a float, what is in it.
    assert.equal(await page.locator(`[${REF}="9"]`).evaluate(el => el.tagName), 'LABEL')
    assert.equal(await page.locator(`[${REF}="5"]`).evaluate(el => el.className), 'float')
    await page.locator(`[${REF}="9"]`).click()
    assert.match(render(await read()), /\[#9 checkbox "同意活动须知" checked\]/u)
    // Under an overlay over most of the viewport nothing can be used; a modal dialog alone is shown.
    await page.evaluate(() => document.body.append(Object.assign(document.createElement('div'), { id: 'overlay' })))
    assert.doesNotMatch(render(await read()), /#6 textbox/u)
    await page.evaluate(() => { document.getElementById('overlay').remove(); const d = document.body.appendChild(document.createElement('dialog')); d.innerHTML = '<h2>确认提交</h2><button>确定</button>'; d.showModal() })
    const dialog = await read()
    assert.equal(dialog.dialog, '确认提交')
    assert.deepEqual(dialog.lines.map(l => l.text), ['## 确认提交', '[#1 button "确定"]'])
    assert.equal(await page.locator(`[${REF}]`).count(), 1)
    // A new document at the same address is not the page read.
    const now = await read()
    await page.reload()
    assert.equal(await page.evaluate(`(${STILL(now, { settle: false })})()`), 'went to another page')
  } finally { await browser.close() }
})

test('a long page is read around where it is scrolled to', { skip: !(runtime && chromium) }, async () => {
  const { chromium: launcher } = createRequire(join(runtime, 'package.json'))('playwright-core')
  const browser = await launcher.launch({ executablePath: chromium, headless: true })
  try {
    const page = await (await browser.newContext({ viewport: { width: 576, height: 744 } })).newPage()
    const body = Array.from({ length: 80 }, (_, i) => `<p>第 ${i + 1} 段 ${'长'.repeat(1000)}</p>`).join('') + '<button>到底了</button>'
    await page.route('https://campus.example/long', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><title>长页面</title>${body}` }))
    await page.goto('https://campus.example/long')
    const read = async () => page.evaluate(`(${READ})()`)
    const top = await read()
    assert.ok(top.truncated && !Object.values(top.refs).some(ref => ref.name === '到底了'))
    assert.match(render(top), /\(The page goes on below what was read: scroll there to read it\.\)$/u)
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight))
    const bottom = await read()
    assert.ok(!bottom.truncated && bottom.skipped > 0)
    assert.match(render(bottom), /\[#\d+ button "到底了"\]\n\(The page goes on above what was read: scroll there to read it\.\)$/u)
    // A long block, or a row of cards, is read in lines placed where they are drawn: the end of it, scrolled to, is read.
    await page.evaluate(() => { document.body.innerHTML = `<p>${'长'.repeat(91000)}<b>尾巴</b></p>`; document.querySelector('b').scrollIntoView() })
    const tail = await read()
    assert.ok(tail.skipped > 0 && tail.lines.at(-1).text.endsWith('尾巴'))
    await page.evaluate(() => { document.body.innerHTML = Array.from({ length: 400 }, (_, i) => `<a href="/c/${i}" style="display: inline-block; width: 500px">卡片${i} ${'说明'.repeat(60)}</a>`).join(''); document.querySelector('a:last-child').scrollIntoView() })
    const cards = await read()
    assert.ok(cards.lines.length > 1 && cards.lines.at(-1).text.includes('卡片399'))
  } finally { await browser.close() }
})

test('browser_act\'s check knows a control by the name the page read showed', { skip: !(runtime && chromium) }, async () => {
  const { chromium: launcher } = createRequire(join(runtime, 'package.json'))('playwright-core')
  const browser = await launcher.launch({ executablePath: chromium, headless: true })
  try {
    const page = await (await browser.newContext({ viewport: { width: 576, height: 744 } })).newPage()
    await page.route('https://campus.example/drafts', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><title>草稿</title>
<input type="button" value="删除草稿 A"> <span id="what">删除草稿 A</span><button aria-labelledby="what">×</button>
<nav id="menu" style="display: none"><a href="https://campus.example/about" style="text-transform: uppercase">About us</a></nav>
<div>姓名<input><span id="error"></span></div>` }))
    await page.goto('https://campus.example/drafts')
    const seen = await page.evaluate(`(${READ})()`)
    const ref = (kind, name) => Number(Object.entries(seen.refs).find(([, r]) => r.kind === kind && r.name === name)[0])
    const still = next => page.evaluate(`(${STILL(seen, { next, settle: false })})()`)
    const [input, labelled, about, field] = [ref('button', '删除草稿 A'), ref('button', '删除草稿 A') + 1, ref('link', 'About us'), ref('textbox', '姓名')]
    assert.deepEqual([await still(input), await still(labelled), await still(about)], ['', '', ''])
    // A message shown beside a field leaves it the same field.
    await page.evaluate(() => { document.getElementById('error').textContent = '必填' })
    assert.equal(await still(field), '')
    // A menu shown with its text in capitals is the same link; a button named for another draft is not the one read.
    await page.evaluate(() => { document.getElementById('menu').style.display = 'block' })
    assert.equal(await still(about), '')
    await page.evaluate(() => { document.querySelector('input').value = '删除草稿 B'; document.getElementById('what').textContent = '删除草稿 B' })
    assert.deepEqual([await still(input), await still(labelled)], ['the page changed', 'the page changed'])
  } finally { await browser.close() }
})
