import assert from 'node:assert/strict'
import test from 'node:test'
import { attachmentNames, decodeBuffer, formatAddress, htmlToText, normalizeBody, pickBodyPart, readMessage, stripQuoted } from '../lib/message.js'
import { readingPayload } from '../lib/text.js'

/**
 * A stand-in for a connected ImapFlow client. `bodyStructure` is the only part
 * of the message that matters here, plus what `download` returns for a part id.
 */
function fakeClient({ bodyStructure, parts = {}, source, seen = [] }) {
  return {
    getMailboxLock: async (folder, options) => {
      seen.push(['lock', folder, options.readOnly])
      return { release: () => seen.push(['release']) }
    },
    fetchOne: async (_range, query) => {
      if (query.source) return source === undefined ? false : { source: Buffer.from(source, 'utf8') }
      return { uid: 7, envelope: { subject: '主题', from: [{ name: '张示例', address: 'z@example.com' }], date: new Date('2026-11-02T05:33:00Z') }, bodyStructure }
    },
    download: async (_range, part) => {
      seen.push(['download', part])
      const value = parts[part]
      if (value === undefined) throw new Error(`unexpected part ${part}`)
      return { content: (async function* () { yield Buffer.from(value, value.startsWith('=') ? 'utf8' : 'utf8') })() }
    },
  }
}

test('a GBK body decodes instead of turning into replacement characters', () => {
  // "中文测试" in GB18030; Chinese enterprise mail still sends this charset.
  const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4])
  assert.equal(decodeBuffer(gbk, 'gb18030'), '中文测试')
  assert.equal(decodeBuffer(gbk, 'GB2312'), '中文测试')
  assert.equal(decodeBuffer(Buffer.from('hello', 'utf8'), 'x-unknown-charset'), 'hello')
  assert.equal(decodeBuffer(Buffer.from('"utf-8"', 'utf8'), 'utf-8'), '"utf-8"')
})

test('HTML mail becomes readable text without tags or entities', () => {
  const text = htmlToText('<style>p{color:red}</style><div>第一行<br>第二行</div><p>a &amp; b &lt;c&gt;</p><script>alert(1)</script>')
  assert.equal(text, '第一行\n第二行\na & b <c>')
  assert.equal(htmlToText('   '), '')
  assert.equal(htmlToText('&#20320;&#22909;'), '你好')
})

test('the preview prefers a plain-text leaf and skips attachments', () => {
  const structure = {
    type: 'multipart/mixed', childNodes: [
      { type: 'multipart/alternative', childNodes: [
        { type: 'text/plain', part: '1.1', parameters: { charset: 'gb18030' } },
        { type: 'text/html', part: '1.2', parameters: { charset: 'utf-8' } },
      ] },
      { type: 'application/pdf', part: '2', disposition: 'attachment', dispositionParameters: { filename: '报价单.pdf' } },
    ],
  }
  assert.deepEqual(pickBodyPart(structure), { part: '1.1', type: 'text/plain', charset: 'gb18030' })
  assert.deepEqual(pickBodyPart({ type: 'text/html', part: '1', parameters: { charset: 'utf-8' } }), { part: '1', type: 'text/html', charset: 'utf-8' })
  assert.equal(pickBodyPart({ type: 'application/pdf', part: '1' }), null)
  assert.deepEqual(attachmentNames(structure), ['报价单.pdf'])
})

test('a body is normalised and capped', () => {
  assert.deepEqual(normalizeBody('a\r\nb\r\n'), { text: 'a\nb', truncated: false })
  const long = normalizeBody('x'.repeat(50), { max: 10 })
  assert.equal(long.truncated, true)
  assert.ok(long.text.startsWith('x'.repeat(10)))
})

test('an address list stays one bounded line', () => {
  assert.equal(formatAddress([{ name: '张示例', address: 'zhang.shili@example.com' }]), '张示例 <zhang.shili@example.com>')
  assert.equal(formatAddress([{ address: 'a@b.c' }, { name: '只有名字' }]), 'a@b.c，只有名字')
  assert.equal(formatAddress(undefined), '')
})

test('a reply chain is cut at the quote header, keeping only the new text', () => {
  // The reported case: a 网易企业邮 reply that quotes the previous two mails.
  const body = [
    '收到来自#187功能的有邮件提醒消息',
    '',
    '---- 回复的原邮件 ----',
    '发件人 朱骏宁<jnzhu@admin.ecnu.edu.cn>',
    '发送日期 2026年11月2日 13:33',
    '收件人 jnzhu<jnzhu@admin.ecnu.edu.cn>',
    '主题 第二次测试',
    '',
    '收到来自#187功能的有邮件提醒消息',
    '',
    '---- 回复的原邮件 ----',
    '发件人 朱骏宁<jnzhu@admin.ecnu.edu.cn>',
    '主题 PR#187邮件提醒测试',
    '收到来自#187功能的有邮件提醒消息',
  ].join('\r\n')
  assert.equal(stripQuoted(body), '收到来自#187功能的有邮件提醒消息')
})

test('the usual quote headers are recognised', () => {
  const cases = [
    ['本行是正文\n-----原始邮件-----\n旧内容', '本行是正文'],
    ['见上\n---------- Forwarded message ----------\nFrom: a@b.c', '见上'],
    ['好的，收到\n在 2026年11月2日 13:19，朱骏宁 <jnzhu@admin.ecnu.edu.cn> 写道：\n> 旧内容', '好的，收到'],
    ['Thanks\nOn Mon, Nov 2, 2026 at 1:19 PM Zhu <jnzhu@admin.ecnu.edu.cn> wrote:\n> old', 'Thanks'],
    ['正文开始\n2026年11月2日 13:19，jnzhu <jnzhu@admin.ecnu.edu.cn> 写道：\n> 旧内容', '正文开始'],
    ['正文\n\n> 整段引用\n> 还是引用', '正文'],
    ['正文\n-- \n签名', '正文'],
  ]
  for (const [input, expected] of cases) assert.equal(stripQuoted(input), expected, input)
})

test('a body without a quote chain is left untouched', () => {
  const body = '第一段\n\n第二段，带一个 - 连字符和 > 比较符号\n\n结束'
  assert.equal(stripQuoted(body), body)
  assert.equal(stripQuoted(''), '')
})

test('a body that is entirely a quote is not emptied', () => {
  const body = '> 只有引用\n> 第二行'
  assert.equal(stripQuoted(body), body)
})

test('a single-part message reads its body instead of coming up empty', async () => {
  // ImapFlow only numbers the nodes below the root, so these structures carry no
  // `part`. Before the fix the preview showed "（没有可预览的正文）" for every
  // plain-text or single-part HTML mail.
  const plain = { type: 'text/plain', parameters: { charset: 'utf-8' } }
  const html = { type: 'text/html', parameters: { charset: 'utf-8' } }
  assert.deepEqual(pickBodyPart(plain), { part: '1', type: 'text/plain', charset: 'utf-8' })
  assert.deepEqual(pickBodyPart(html), { part: '1', type: 'text/html', charset: 'utf-8' })

  const seen = []
  const message = await readMessage(fakeClient({ bodyStructure: plain, parts: { 1: '第一段\n第二段' }, seen }), 'INBOX', 7)
  assert.equal(message.body, '第一段\n第二段')
  assert.equal(message.subject, '主题')
  assert.equal(message.from, '张示例 <z@example.com>')
  assert.deepEqual(seen, [['lock', 'INBOX', true], ['download', '1'], ['release']])

  const rendered = await readMessage(fakeClient({ bodyStructure: html, parts: { 1: '<p>正文</p>' } }), 'INBOX', 7)
  assert.equal(rendered.body, '正文')
})

test('a message with no recognisable part falls back to the raw source', async () => {
  const source = ['Subject: 原始', 'Content-Type: message/rfc822', '', '回退正文第一行', '第二行'].join('\r\n')
  const message = await readMessage(fakeClient({ bodyStructure: { type: 'message/rfc822', parameters: {} }, source }), 'INBOX', 7)
  assert.equal(message.body, '回退正文第一行\n第二行')
})

test('a long single-part body still reaches the panel within the target budget', async () => {
  // The preview travels back as the click target, which the registry caps at
  // 4096 characters of JSON. A long mail must be clipped, not dropped.
  const long = Array.from({ length: 700 }, (_, index) => `第${index + 1}段：这是一封比较长的邮件正文，用来确认截断之后预览里仍然有内容可看。`).join('\n\n')
  assert.ok(long.length > 20_000, 'fixture must exceed the body cap')
  const message = await readMessage(fakeClient({ bodyStructure: { type: 'text/plain', parameters: { charset: 'utf-8' } }, parts: { 1: long } }), 'INBOX', 7)
  assert.equal(message.truncated, true)
  const payload = readingPayload(message, { folder: 'INBOX', uid: 7 })
  assert.ok(payload.text.length > 0, 'a long body must not become an empty preview')
  assert.ok(JSON.stringify(payload).length <= 4096, 'the payload must fit the protocol target')
  assert.ok(payload.text.startsWith('第1段'))
})

