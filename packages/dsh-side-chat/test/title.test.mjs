import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTitleInput, normalizeTitle, questionAndAnswerOf, titleSystem, truncateUtf8 } from '../src/title.js'

test('normalizeTitle strips terminal and invisible controls and collapses whitespace', () => {
  const raw = '\u001B[31m  上海​天气 \u001B[0m\n  查询  '
  assert.equal(normalizeTitle(raw), '上海天气 查询')
})

test('normalizeTitle enforces the UTF-8 byte budget without splitting a code point', () => {
  assert.equal(normalizeTitle('汉'.repeat(30)), '汉'.repeat(20))
  assert.equal(truncateUtf8('汉'.repeat(10), 60), '汉'.repeat(10))
  assert.equal(normalizeTitle(''), '')
  assert.equal(normalizeTitle(undefined), '')
})

test('buildTitleInput labels and bounds each part in the requested locale', () => {
  const zh = buildTitleInput('问题'.repeat(300), '回答'.repeat(900), 'zh')
  assert.ok(zh.startsWith('问题：问题'))
  assert.ok(zh.includes('\n回答：回答'))
  assert.ok(zh.length <= 4000)
  const en = buildTitleInput('Q', 'A', 'en')
  assert.ok(en.startsWith('Question: Q'))
  assert.ok(en.includes('\nAnswer: A'))
  assert.match(titleSystem('zh'), /只输出标题/)
  assert.match(titleSystem('en'), /Output ONLY the title/)
})

test('questionAndAnswerOf skips plugin user messages and non-text events', () => {
  const events = [
    { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'runtime snapshot' }] } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '天气如何' }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: '多云' }] } } },
    { type: 'tool/result', data: { text: 'ignored' } },
  ]
  assert.deepEqual(questionAndAnswerOf(events), { question: '天气如何', answer: '多云' })
})
