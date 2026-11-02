import assert from 'node:assert/strict'
import test from 'node:test'
import { attachmentNames, decodeBuffer, formatAddress, htmlToText, normalizeBody, pickBodyPart } from '../lib/message.js'

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
