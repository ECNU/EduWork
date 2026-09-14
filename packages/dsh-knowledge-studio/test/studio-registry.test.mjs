import assert from 'node:assert/strict'
import test from 'node:test'
import { StudioRegistry } from '../lib/capabilities.js'

test('built-in Studio capabilities exclude workspace knowledge and retain trusted artifacts', () => {
  const registry = new StudioRegistry()
  const values = registry.list()
  assert.deepEqual(values.filter(item => item.available).map(item => item.id), ['report', 'mindmap', 'quiz', 'flashcards', 'table', 'slides', 'audio', 'video'])
  assert.equal(values.find(item => item.id === 'report').output, 'document')
  assert.equal(values.some(item=>item.id==='infographic'),false)
  assert.equal(values.some(item => item.id === 'workspace-wiki'), false)
  assert.equal(values.find(item => item.id === 'quiz').interaction, 'dialog')
  assert.deepEqual(values.find(item => item.id === 'quiz').parameters.map(p=>p.id), ['count','difficulty','focus','language','audience','pathPrefix'])
  assert.equal('prompt' in values.find(item => item.id === 'report'), false, 'private execution prompts must not leak to the client')
})

test('independent plugins can register and dispose a Studio capability', () => {
  const registry = new StudioRegistry()
  const execute = async () => ({ action: 'artifact' })
  const dispose = registry.register({
    id: 'data-table', title: '数据表', description: '结构化数据', available: true,
    interaction: 'dialog', execution: 'artifact', output: 'document', rendererKey: 'data-table',
  }, execute)
  assert.equal(registry.get('data-table').execute, execute)
  assert.equal(registry.list().some(item => item.id === 'data-table'), true)
  dispose()
  assert.equal(registry.get('data-table'), null)
})

test('Studio capability registration rejects unstable contracts', () => {
  const registry = new StudioRegistry()
  assert.throws(() => registry.register({ id: 'Bad ID', title: 'bad' }), /stable lowercase id/)
  assert.throws(() => registry.register({ id: 'report', title: 'duplicate', interaction: 'none', execution: 'conversation', output: 'chat' }), /already registered/)
})
