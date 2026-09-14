import assert from 'node:assert/strict'
import test from 'node:test'
import {
  accountOrganization, accountStatusLine, accountUserName, modelCapabilitySummary, runtimeModelDraft, serializeRuntimeModelDraft,
} from '../src/client/presentation.js'

const profile = { displayName: 'ECNU Chat', organization: '华东师范大学' }

test('account presentation prefers the standard UserInfo name projected as userName', () => {
  const userName = accountUserName({ userName: '  示例用户  ', credentialReady: true })
  assert.equal(userName, '示例用户')
  assert.equal(accountStatusLine(profile, '企业模型已连接', userName), '华东师范大学 · 企业模型已连接')
})

test('account presentation keeps institution branding when no identity session exists', () => {
  const userName = accountUserName({ credentialReady: false })
  assert.equal(userName, '')
  assert.equal(accountStatusLine(profile, '点击设置完成登录', userName), '点击设置完成登录')
})

test('bounded brand organization name overrides the deployment label on presentation surfaces', () => {
  const branded = { ...profile, brand: { organizationName: '示例大学' } }
  assert.equal(accountOrganization(branded), '示例大学')
  assert.equal(accountStatusLine(branded, '企业模型已连接', '示例用户'), '示例大学 · 企业模型已连接')
})

test('shared provider presentation preserves desktop model capabilities', () => {
  const summary = modelCapabilitySummary({
    id: 'campus-plus', name: 'Campus Plus', input: ['text', 'image'],
    reasoningEfforts: { high: 'high', low: 'low' },
  }, { defaultContextWindow: 262144, defaultMaxTokens: 32768 })
  assert.equal(summary.multimodal, true)
  assert.deepEqual(summary.reasoningEfforts, ['low', 'high'])
  assert.equal(summary.contextWindow, '256K')

  const draft = runtimeModelDraft({ id: 'campus-plus', input: ['text', 'image'], reasoning: false })
  assert.equal(draft.reasoningSupported, false)
  assert.deepEqual(serializeRuntimeModelDraft(draft), { id: 'campus-plus', name: 'campus-plus', input: ['text', 'image'], reasoning: false })

  const exact = runtimeModelDraft({
    id: 'reasoner', reasoningEfforts: { low: 'low', medium: 'medium', xhigh: 'xhigh' }, defaultReasoningEffort: 'medium',
  })
  assert.deepEqual(serializeRuntimeModelDraft(exact), {
    id: 'reasoner', name: 'reasoner', input: ['text'],
    reasoningEfforts: { low: 'low', medium: 'medium', xhigh: 'xhigh' }, defaultReasoningEffort: 'medium',
    compat: { supportsReasoningEffort: true },
  })
  exact.defaultReasoningEffort = 'max'
  assert.throws(() => serializeRuntimeModelDraft(exact), /must be one of the selected/)
})
