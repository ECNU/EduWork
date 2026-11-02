import assert from 'node:assert/strict'
import test from 'node:test'
import { attachmentNames, decodeBuffer, formatAddress, htmlToText, normalizeBody, pickBodyPart, stripQuoted } from '../lib/message.js'

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