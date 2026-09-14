import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { loadEnterpriseModelUpdates, updateEnterpriseModels } from '../enterprise-model-updates.mjs'

const enterprise = {
  id: 'university', oidc: { issuer: 'https://id.example.edu' },
  provider: { id: 'school-ai', adapter: 'openai-compatible', baseURL: 'https://ai.example.edu/v1', modelSource: 'profile',
    models: [{ id: 'main', input: ['text'], maxTokens: 12345, reasoningEfforts: { low: 'low', max: 'max' } },
      { id: 'my-text-model', input: ['text'], maxTokens: 999 }] },
}
const catalog = { schemaVersion: 1, updates: [{
  match: { profileID: 'university', issuer: 'https://id.example.edu', providerID: 'school-ai',
    adapter: 'openai-compatible', baseURL: 'https://ai.example.edu/v1', modelID: 'main' },
  fromInput: ['text'], toInput: ['text', 'image'],
}] }

test('only known old enterprise input is reconciled; administrator data and unrelated fields survive', () => {
  const before = structuredClone(enterprise)
  const [updated] = updateEnterpriseModels([enterprise], catalog)
  const expected = structuredClone(enterprise)
  expected.provider.models[0].input.push('image')
  assert.deepEqual(updated, expected)
  assert.deepEqual(enterprise, before)
  assert.equal(updated.provider.models[1], enterprise.provider.models[1])
  assert.deepEqual(updateEnterpriseModels([updated], catalog), [updated])
})

test('same model name is not ownership: different enterprises, custom routes and discovery are untouched', () => {
  const changes = [
    item => { item.id = 'personal' },
    item => { item.oidc.issuer = 'https://other.example.edu' },
    item => { item.provider.id = 'personal' },
    item => { item.provider.baseURL = 'https://custom.example.edu/v1' },
    item => { item.provider.adapter = 'custom-adapter' },
    item => { item.provider.modelSource = 'discovery' },
    item => { item.provider.models[0].id = 'my-model' },
    item => { item.provider.models[0].input = ['image'] },
    item => { item.provider.models[0].input = ['text', 'image'] },
    item => { delete item.provider },
  ]
  for (const change of changes) {
    const item = structuredClone(enterprise); change(item)
    assert.equal(updateEnterpriseModels([item], catalog)[0], item)
  }
})

test('public assemblies without institution catalog are unchanged; malformed catalogs cannot supply arbitrary overrides', async t => {
  const product = await mkdtemp(join(tmpdir(), 'eduwork-catalog-'))
  t.after(() => rm(product, { recursive: true, force: true }))
  const organizations = [enterprise]
  assert.equal(await loadEnterpriseModelUpdates(product, organizations), organizations)
  assert.throws(() => updateEnterpriseModels(organizations, {schemaVersion:2,updates:[]}), /Invalid/)
  assert.throws(() => updateEnterpriseModels(organizations, {schemaVersion:1,updates:[{match:{modelID:'main'},fromInput:['text'],toInput:['image']}]}), /Invalid/)
  const altered = structuredClone(catalog)
  altered.updates[0].baseURL = 'https://other.example.edu'
  altered.updates[0].apiKey = 'synthetic-not-a-secret'
  const [updated] = updateEnterpriseModels(organizations, altered)
  assert.equal(updated.provider.baseURL, enterprise.provider.baseURL)
  assert.equal(updated.provider.apiKey, undefined)
})

test('context correction is independent of image migration and preserves explicit custom limits and other models', () => {
  const rules = structuredClone(catalog)
  Object.assign(rules.updates[0], {fromContextWindow:1000000,toContextWindow:524288})
  for (const native of [false,true]) for (const inherited of [false,true]) {
    const item = structuredClone(enterprise)
    item.provider.defaultContextWindow = 1000000
    if (!inherited) item.provider.models[0].contextWindow = 1000000
    if (native) item.provider.models[0].input = ['text','image']
    const [updated] = updateEnterpriseModels([item], rules)
    assert.equal(updated.provider.models[0].contextWindow,524288)
    assert.deepEqual(updated.provider.models[0].input,['text','image'])
    assert.equal(updated.provider.defaultContextWindow,1000000)
    assert.equal(updated.provider.models[1],item.provider.models[1])
    assert.equal(updated.provider.models[0].maxTokens,item.provider.models[0].maxTokens)
    assert.equal(updateEnterpriseModels([updated],rules)[0],updated)
  }
  const custom = structuredClone(enterprise)
  custom.provider.models[0] = {...custom.provider.models[0],input:['text','image'],contextWindow:131072}
  assert.equal(updateEnterpriseModels([custom],rules)[0],custom)
  for (const invalid of [0,-1,1.5,'262144',undefined]) {
    const malformed = structuredClone(rules)
    malformed.updates[0].toContextWindow = invalid
    assert.throws(()=>updateEnterpriseModels([enterprise],malformed),/Invalid/)
  }
})

test('official rc2 compaction uses the newly resolved capacity when continuing existing history', {skip:!process.env.EDUWORK_TEST_RUNTIME}, async t => {
  const req = createRequire(join(process.env.EDUWORK_TEST_RUNTIME,'package.json'))
  const module = name => import(pathToFileURL(req.resolve(name)).href)
  const [{Context},llm,{Session,SessionId},projection,meter,{BasicCompactionEngine}] = await Promise.all([
    module('@deepseek-ai/cordis'),module('@deepseek-ai/dsh-llm'),module('@deepseek-ai/dsh-session'),
    module('@deepseek-ai/dsh-session-projection'),module('@deepseek-ai/dsh-token-meter'),module('@deepseek-ai/dsh-compaction-basic'),
  ])
  const ctx = new Context()
  t.after(()=>ctx.fiber.dispose())
  new llm.default(ctx); new projection.default(ctx); new meter.default(ctx)
  let contextWindow = 1000000, summaries = 0
  class Adapter extends llm.LlmAdapter {
    async resolveModel(provider,model) { return {provider,id:model,name:model,context:{contextWindow}} }
    async *stream() { throw new Error('This local test must not call a model service') }
  }
  ctx.llm.registerAdapter(['school-ai'],new Adapter())
  class Compaction extends BasicCompactionEngine {
    async summarize() { summaries++; return {summary:[{type:'text',text:'Synthetic history checkpoint'}],provider:'school-ai',model:'main',maxTokens:8192} }
  }
  const compact = new Compaction(ctx)
  assert.equal(compact.config.auto,true)
  assert.equal(compact.config.thresholdRatio,0.8)
  const session = Session.create(SessionId('context-upgrade-fixture'))
  for (let turn=1;turn<=4;turn++) {
    session.append('turn/start',{turn})
    session.append('user/message',llm.createUserMessage({content:[{type:'text',text:'word '.repeat(60000)}],source:{kind:'user'}}),{surfaceOp:'append'})
    session.append('step/start',{turn,step:1})
    if (turn===1) session.append('request/header',{header:{config:{provider:'school-ai',model:'main'}},reason:'initial'})
    session.append('assistant/message',{stream:[],turn,step:1,message:llm.createMessage({role:'assistant',content:[{type:'text',text:'reply '.repeat(50000)}],source:{kind:'model',provider:'school-ai',model:'main'}})},{surfaceOp:'append'})
    session.append('step/end',{turn,step:1})
    session.append('turn/end',{turn,reason:{kind:'completed'}})
  }
  session.append('turn/start',{turn:5})
  const agent = {session,options:{provider:'school-ai',model:'main'}}
  const signal = new AbortController().signal
  const before = ctx.tokenMeter.measure(session).totalTokens
  assert.ok(before >= 419430 && before < 800000, String(before))
  assert.equal(await compact.compactIfNeeded(agent,'pressure',signal),null)
  contextWindow = 524288
  assert.ok(await compact.compactIfNeeded(agent,'pressure',signal))
  assert.equal(summaries,1)
  assert.ok(ctx.tokenMeter.measure(session).totalTokens < 419430)
})
