import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readlink, realpath, rename, symlink, lstat, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { prepareProductProfile } from '../product-profile.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-desktop-profile-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = join(root, 'app/product'), home = join(root, 'app/data')
  await mkdir(join(product, 'd/node_modules'), { recursive: true })
  await mkdir(join(product, 'd/presets/standard'), { recursive: true })
  await writeFile(join(product, 'd/presets/standard/agent.cordis.yml'), '[]')
  await writeFile(join(product, 'assembly.json'), JSON.stringify({ distribution: 'eduwork', dshVersion: '0.1.5-rc.2', dshCommit: 'fb2c4b9e698e30edb738bca4cf0618587db7d203', bundles: ['@deepseek-ai/dsh-bundle-base'] }))
  await writeFile(join(product, 'composition.json'), JSON.stringify([{ id: 'session-query-sqlite' }, { insert: [{ id: 'enterprise-oidc', name: '@eduwork/dsh-oidc', config: { backend: 'web', publicOption: true } }] }]))
  return { root, product, home }
}

test('mail, memory and literature settings reach installed bundle rows without admitting uninstalled plugins', async t => {
  const { root, product, home } = await fixture(t)
  const identity = JSON.parse(await readFile(join(product, 'assembly.json')))
  identity.bundles.push('@eduwork/dsh-mail', '@eduwork/dsh-memory', '@shlv/dsh-literature')
  await writeFile(join(product, 'assembly.json'), JSON.stringify(identity))
  const userConfig = join(root, 'eduwork.jsonc')
  const plugins = { 'dsh-mail-assistant': { imapHost: 'mail.example.test', readEnabled: false }, 'local-memory': { max_records: 50 },
    literature: { timeoutMs: 90000 }, 'literature-dblp': { rateLimitMs: 2000 },
    'literature-arxiv': { apiBase: 'https://arxiv.example.test' }, 'tool-literature': { subagentProvider: 'spawn' } }
  await writeFile(userConfig, JSON.stringify({ schemaVersion: 1, plugins }))
  const prepared = await prepareProductProfile({ product, home, shell: 'electron', userConfig })
  const rows = JSON.parse(await readFile(join(prepared.profile, 'cordis.patch.yml')))
  for (const [id, config] of Object.entries(plugins)) assert.deepEqual(rows.find(row => row.id === id).config, config)
  identity.bundles = []
  await writeFile(join(product, 'assembly.json'), JSON.stringify(identity))
  await assert.rejects(prepareProductProfile({ product, home, shell: 'electron', userConfig }), /不属于此发行版/)
})

test('rc.1 reads independent request and subagent defaults below saved UI choices', async t => {
  const { root, product, home } = await fixture(t)
  await writeFile(join(product, 'assembly.json'), JSON.stringify({ distribution: 'eduwork', dshVersion: '0.1.7-rc.1', dshCommit: '46a7f68b0922371ce7144b668b90e377d8e799f4', bundles: ['@deepseek-ai/dsh-base'] }))
  // JSON is sufficient for the synthetic bundle; the real Host probe covers YAML.
  const yaml = join(product, 'd/node_modules/yaml')
  await mkdir(yaml, { recursive: true })
  await writeFile(join(yaml, 'package.json'), '{"type":"module","exports":"./index.js"}')
  await writeFile(join(yaml, 'index.js'), 'export const parse = JSON.parse')
  const presets = join(product, 'd/node_modules/@deepseek-ai/dsh-web-app/presets')
  await mkdir(presets, { recursive: true })
  for (const id of ['standard', 'ptc', 'minimal', 'cordis']) await writeFile(join(presets, id+'.patch.yml'), JSON.stringify([{ insert: [{ id: 'preset-'+id, config: { plugins: [] } }] }]))
  const userConfig = join(root, 'eduwork.jsonc')
  const options = { product, home, shell: 'electron', userConfig }
  const configure = async features => {
    await writeFile(userConfig, JSON.stringify({ schemaVersion: 1, features }))
    const { profile } = await prepareProductProfile(options)
    const patches = JSON.parse(await readFile(join(profile, 'node_modules/@eduwork/generated-profile/cordis.patch.yml')))
    return { profile, subagent: patches.find(row => row.id === 'subagent').config, requests: patches.find(row => row.id === 'eduwork-concurrency').config }
  }
  let current = await configure({})
  assert.deepEqual(current.subagent, { maxActiveSubagents: 2 })
  assert.deepEqual(current.requests, { maxConcurrentRequests: 3 })
  current = await configure({ maxActiveSubagents: 4, maxConcurrentRequests: 6 })
  assert.equal(current.subagent.maxActiveSubagents, 4)
  assert.equal(current.requests.maxConcurrentRequests, 6)
  // Preserve explicit settings even when they happen to equal the old defaults.
  const preferences = [{ id: 'subagent', config: { maxActiveSubagents: 4, maxDepth: 2 } },
    { id: 'eduwork-concurrency', config: { maxConcurrentRequests: 6 } }]
  await writeFile(join(current.profile, 'cordis.patch.yml'), JSON.stringify(preferences))
  current = await configure({ maxActiveSubagents: 1, maxConcurrentRequests: 2 })
  assert.equal(current.subagent.maxActiveSubagents, 1)
  assert.equal(current.requests.maxConcurrentRequests, 2)
  assert.deepEqual(JSON.parse(await readFile(join(current.profile, 'cordis.patch.yml'))), preferences)
  // Without a saved preference, legacy input still converts only the request limit.
  await writeFile(join(current.profile, 'cordis.patch.yml'), '[]')
  current = await configure({ maxParallelSubagents: 4 })
  assert.equal(current.requests.maxConcurrentRequests, 5)
  assert.equal(current.subagent.maxActiveSubagents, 2)
})

test('both shells activate only configured media tools and reread capability switches without rewriting JSONC', async t => {
  const { root, product } = await fixture(t)
  const composition = JSON.parse(await readFile(join(product, 'composition.json'), 'utf8'))
  composition.push({ insert: [{ id: 'eduwork-media-openai', config: { providers: [] } }, { id: 'eduwork-artifact-services', config: { skills: false, images: { enabled: false } } }] })
  await writeFile(join(product, 'composition.json'), JSON.stringify(composition))
  const userConfig = join(root, 'eduwork.jsonc')
  const config = { schemaVersion: 1, organizations: [], media: { providers: [{ id: 'example', protocol: 'openai-compatible',
    baseURL: 'https://media.example.test/v1', images: { enabled: true, model: 'image-example', nativeSizes: ['1024x1024'] } }] } }
  for (const shell of ['electron', 'wails']) {
    for (const enabled of [true, false]) {
      config.media.providers[0].images.enabled = enabled
      const body = JSON.stringify(config)
      await writeFile(userConfig, body)
      const result = await prepareProductProfile({ product, home: join(root, 'data-' + shell), shell, userConfig })
      const rows = JSON.parse(await readFile(join(result.profile, 'cordis.patch.yml'), 'utf8')).flatMap(row => row.insert ?? [])
      assert.equal(rows.find(row => row.id === 'eduwork-artifact-services').config.images.enabled, enabled)
      assert.equal(Boolean(rows.find(row => row.id === 'eduwork-media-openai').config.providers[0].images), enabled)
      assert.equal(await readFile(userConfig, 'utf8'), body)
    }
  }
})

test('publisher configuration exposes the same editable file as the generic edition', async t => {
  const {root,product,home}=await fixture(t)
  const userConfig=join(root,'edition.jsonc')
  await writeFile(userConfig,'{"schemaVersion":1,"organizations":[],"product":{"name":"School managed"}}')
  const result=await prepareProductProfile({product,home,shell:'electron',userConfig,configurationOwnership:'publisher'})
  const rows=JSON.parse(await readFile(join(result.profile,'cordis.patch.yml'),'utf8')).flatMap(row=>row.insert??[])
  assert.equal(rows.find(row=>row.id==='enterprise-oidc').config.configFile.path,userConfig)
  assert.equal(rows.find(row=>row.id==='enterprise-oidc').config.allowEmptyProfiles,true)
})

test('moving the whole product repairs only its managed module link and keeps history', async t => {
  const { root, product, home } = await fixture(t)
  await prepareProductProfile({ product, home, shell: 'electron' })
  await writeFile(join(home, 'synthetic-history.json'), '{"retained":true}')
  const moved = join(root, '新位置 with spaces')
  await rename(join(root, 'app'), moved)
  const prepared = await prepareProductProfile({ product: join(moved, 'product'), home: join(moved, 'data'), shell: 'electron' })
  assert.equal(await realpath(join(prepared.profile, 'node_modules')), await realpath(join(moved, 'product/d/node_modules')))
  assert.equal(await readFile(join(moved, 'data/synthetic-history.json'), 'utf8'), '{"retained":true}')
  const patch = JSON.parse(await readFile(join(prepared.profile, 'cordis.patch.yml'), 'utf8'))
  assert.equal(patch[1].insert[0].config.backend, 'desktop')
  assert.equal(patch[1].insert[0].config.publicOption, true)
  assert.ok(patch.some(row => row.id === 'credentials' && row.disabled))
  assert.ok(!patch.some(row => row.id === 'session-controller' && row.disabled))
  assert.ok(patch.some(row => row.insert?.some(plugin => plugin.id === 'eduwork-native-reveal' && plugin.name === '@chatecnu-work/dsh-artifact-preview-native/session-controller')))
  assert.ok(patch.some(row => row.insert?.some(plugin => plugin.name === '@chatecnu-work/dsh-credentials-native')))
})

test('another shell, distribution, or product-contained home is rejected without overwriting ownership', async t => {
  const { product, home } = await fixture(t)
  await prepareProductProfile({ product, home, shell: 'electron' })
  await assert.rejects(prepareProductProfile({ product, home, shell: 'wails' }), /another desktop edition/)
  await assert.rejects(prepareProductProfile({ product, home: join(product, 'data'), shell: 'electron' }), /isolated/)
  const identity = JSON.parse(await readFile(join(product, 'assembly.json'), 'utf8'))
  identity.distribution = 'eduwork-ecnu'
  await writeFile(join(product, 'assembly.json'), JSON.stringify(identity))
  await assert.rejects(prepareProductProfile({ product, home, shell: 'electron' }), /another desktop edition/)
  assert.equal(JSON.parse(await readFile(join(home, '.eduwork-desktop-home.json'), 'utf8')).distribution, 'eduwork')
})

test('unmanaged directories and links survive a refused repair', async t => {
  const { root, product, home } = await fixture(t)
  const modules = join(home, 'profiles/desktop/node_modules')
  await mkdir(modules, { recursive: true })
  await writeFile(join(modules, 'precious.txt'), 'retain')
  await assert.rejects(prepareProductProfile({ product, home, shell: 'wails' }), /unmanaged module directory/)
  assert.equal(await readFile(join(modules, 'precious.txt'), 'utf8'), 'retain')
  const otherHome = join(root, 'other-data'), otherModules = join(otherHome, 'profiles/desktop/node_modules')
  await mkdir(join(otherHome, 'profiles/desktop'), { recursive: true })
  await symlink(modules, otherModules, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(prepareProductProfile({ product, home: otherHome, shell: 'wails' }), /unmanaged module link/)
  assert.ok((await lstat(otherModules)).isSymbolicLink())
})

test('an interrupted managed link replacement resumes after the directory moves', async t => {
  const { root, product, home } = await fixture(t)
  const before = await prepareProductProfile({ product, home, shell: 'electron' })
  const oldTarget = join(product, 'd/node_modules')
  const movedProduct = join(root, 'new product')
  await rename(product, movedProduct)
  const target = join(movedProduct, 'd/node_modules')
  await writeFile(join(before.profile, '.eduwork-module-link.pending.json'), JSON.stringify({ schemaVersion: 1, previous: oldTarget, target }))
  await unlink(join(before.profile, 'node_modules'))
  await symlink(target, join(before.profile, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  // Simulate the process ending here, before committing its normal receipt.
  await prepareProductProfile({ product: movedProduct, home, shell: 'electron' })
  assert.equal(JSON.parse(await readFile(join(before.profile, '.eduwork-module-link.json'), 'utf8')).target, await realpath(target))
  await assert.rejects(lstat(join(before.profile, '.eduwork-module-link.pending.json')), { code: 'ENOENT' })
})

test('junction aliases cannot bypass product/data overlap checks', async t => {
  const { root, product } = await fixture(t)
  const alias = join(root, 'alias')
  await symlink(product, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(prepareProductProfile({ product, home: join(alias, 'new-data'), shell: 'electron' }), /isolated/)
  await assert.rejects(lstat(join(product, 'new-data')), { code: 'ENOENT' })
})

test('both shells pass total request limits and legacy conversions through the shared boundary', async t => {
  const {root,product,home}=await fixture(t)
  const config=join(root,'eduwork.jsonc')
  for(const shell of ['electron','wails']) {
    for(const [budget,total] of [[{},3],[{maxParallelSubagents:2},3],[{maxConcurrentRequests:2},2],[{maxConcurrentRequests:1,maxParallelSubagents:2},1]]) {
      const source=JSON.stringify({schemaVersion:1,features:{visionFallback:false,...budget}})
      await writeFile(config,source)
      const result=await prepareProductProfile({product,home:home+'-'+shell,shell,userConfig:config})
      assert.equal(result.environment.EDUWORK_VISION_FALLBACK,'false')
      assert.equal(result.environment.EDUWORK_MAX_CONCURRENT_REQUESTS,String(total))
      assert.equal(result.environment.EDUWORK_MAX_PARALLEL_SUBAGENTS,undefined)
      assert.equal(await readFile(config,'utf8'),source)
    }
  }
})

test('Electron validates Token profiles from the visible file without changing personal providers', {skip: !process.env.EDUWORK_TEST_RUNTIME}, async t => {
  const {root,product,home} = await fixture(t)
  const runtime = process.env.EDUWORK_TEST_RUNTIME
  await mkdir(join(product, 'd/node_modules/@eduwork'), {recursive:true})
  await symlink(join(runtime, 'node_modules/@eduwork/dsh-oidc'), join(product, 'd/node_modules/@eduwork/dsh-oidc'), process.platform === 'win32' ? 'junction' : 'dir')
  const org = {
    schemaVersion:'dsh-oidc/v1alpha1', id:'university', displayName:'Example University', organization:'Example University',
    auth:{discoveryUrl:'https://ai.example.edu/.well-known/openid-configuration',expectedIssuer:'https://ai.example.edu',experimentalOidcLlm:true,clientId:'synthetic-public-client',identityMode:'oidc'},
    provider:{id:'school-ai',displayName:'Enterprise models',adapter:'openai-compatible',modelSource:'discovery',
      models:[{id:'main',name:'Main',input:['text'],contextWindow:1000000,maxTokens:393216,reasoningEfforts:{low:'low',high:'high',max:'max'},defaultReasoningEffort:'high'},
        {id:'secondary',name:'Secondary',input:['text','image'],contextWindow:262144,maxTokens:65536,compat:{supportsReasoningEffort:false}}]},
  }
  const config = join(root, 'eduwork.jsonc')
  const body = '\uFEFF// Administrator comments and settings are retained\r\n' + JSON.stringify({schemaVersion:1,organizations:[org]})
  await writeFile(config, body)
  const req = createRequire(join(runtime, 'package.json'))
  const {loadEnterpriseProfiles, enterpriseProviderConfig} = await import(pathToFileURL(req.resolve('@eduwork/dsh-oidc/profile')).href)
  for (const shell of ['electron']) {
    const data = home + '-' + shell
    await mkdir(data, {recursive:true})
    // A personal provider deliberately has the same model ID as the enterprise.
    const personal = JSON.stringify({providers:{personal:{baseURL:'https://personal.example.net/v1',models:[{id:'main',input:['text']}]}}},null,2)
    const selected = JSON.stringify({providerID:'personal',modelID:'main'})
    await writeFile(join(data,'settings.yaml'),personal)
    await writeFile(join(data,'selected-model.json'),selected)
    const before = await readFile(config)
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await prepareProductProfile({product,home:data,shell,userConfig:config})
      const patch = JSON.parse(await readFile(join(result.profile, 'cordis.patch.yml'), 'utf8'))
      const effective = patch.flatMap(row => row.insert ?? []).find(row => row.id === 'enterprise-oidc').config
      const profiles = loadEnterpriseProfiles(effective, {})
      assert.deepEqual(enterpriseProviderConfig(profiles).providers,{})
      const provider = profiles.get(org.id).provider
      assert.deepEqual(provider.models[0].input,['text'])
      assert.equal(provider.models[0].contextWindow,1000000)
      assert.deepEqual(provider.models[0].reasoningEfforts,org.provider.models[0].reasoningEfforts)
      assert.equal(provider.models[0].maxTokens,393216)
      assert.equal(provider.models[1].compat.supportsReasoningEffort,false)
      assert.deepEqual(await readFile(config),before)
      assert.equal(await readFile(join(data,'settings.yaml'),'utf8'),personal)
      assert.equal(await readFile(join(data,'selected-model.json'),'utf8'),selected)
    }
    // Content activation writes the actual file before starting the Host;
    // an in-memory configurationPatch can no longer override that file.
    await writeFile(config,JSON.stringify({schemaVersion:1,organizations:[org],features:{visionFallback:true}}))
    const managedContent={configurationRevision:2,configurationPatch:{organizations:[]},skillsRevision:2,skillRoot:join(root,'signed-skills')}
    const prepared=await prepareProductProfile({product,home:data,shell,userConfig:config,managedContent})
    const managed=JSON.parse(await readFile(join(prepared.profile,'cordis.patch.yml'),'utf8')).flatMap(row=>row.insert??[]).find(row=>row.id==='enterprise-oidc').config
    assert.deepEqual(managed.profiles[0].provider.models[0].input,['text'])
    assert.equal(managed.configFile.path,config)
    assert.equal(prepared.environment.EDUWORK_VISION_FALLBACK,'true')
    assert.equal(prepared.environment.DSH_BUNDLED_SKILL_DIR,managedContent.skillRoot)
    assert.equal(await readFile(join(data,'settings.yaml'),'utf8'),personal)
  }
})

test('an explicitly promoted current installation starts with normal data ownership',async t=>{
 const {root}=await fixture(t),product=join(root,'current/product'),home=join(root,'current/data')
 await rename(join(root,'app'),join(root,'current'))
 const result=await prepareProductProfile({product,home,shell:'wails'})
 assert.equal(JSON.parse(await readFile(join(home,'.eduwork-desktop-home.json'),'utf8')).shell,'wails')
 assert.equal(await realpath(join(result.profile,'node_modules')),await realpath(join(product,'d/node_modules')))
})


test('one configuration file overrides installed plugin endpoints but cannot add plugins', async t => {
  const {root,product,home}=await fixture(t)
  const composition=JSON.parse(await readFile(join(product,'composition.json'),'utf8'))
  composition.push({insert:[{id:'example-service',name:'example',config:{baseURL:'https://prod.example.test',nested:{keep:true,enabled:true}}}]})
  await writeFile(join(product,'composition.json'),JSON.stringify(composition))
  const userConfig=join(root,'eduwork.jsonc')
  const body=JSON.stringify({schemaVersion:1,plugins:{'example-service':{baseURL:'https://uat.example.test',nested:{enabled:false}}}})
  await writeFile(userConfig,body)
  const result=await prepareProductProfile({product,home,shell:'electron',userConfig})
  const service=JSON.parse(await readFile(join(result.profile,'cordis.patch.yml'),'utf8')).flatMap(row=>row.insert??[]).find(plugin=>plugin.id==='example-service')
  assert.deepEqual(service.config,{baseURL:'https://uat.example.test',nested:{keep:true,enabled:false}})
  assert.equal(await readFile(userConfig,'utf8'),body)
  await writeFile(userConfig,JSON.stringify({schemaVersion:1,plugins:{'not-installed':{}}}))
  await assert.rejects(prepareProductProfile({product,home,shell:'electron',userConfig}),/not-installed/)
})
