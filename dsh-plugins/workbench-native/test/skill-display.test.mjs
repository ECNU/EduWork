import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { skillDisplayMetadata } from '../lib/skill-display.js'

const runtime = process.env.EDUWORK_TEST_RUNTIME
const hooks = registerHooks({ resolve(specifier, context, next) {
  const sources = {
    '@chatecnu-work/dsh-skill-control-native/core': '../../skill-control-native/lib/core.js',
    '@chatecnu-work/dsh-skill-settings-native/policy': '../../skill-settings-native/lib/policy.js',
  }
  if (sources[specifier]) return next(new URL(sources[specifier], import.meta.url).href, context)
  if (runtime && (specifier.startsWith('@deepseek-ai/') || ['yaml', 'zod'].includes(specifier)))
    return next(specifier, { ...context, parentURL: pathToFileURL(resolve(runtime, 'package.json')).href })
  return next(specifier, context)
} })
test.after(() => hooks.deregister())
const { skillCenterRows } = await import('../lib/view-model.js')

test('publisher card text replaces product defaults without changing skill identity or settings', () => {
  const display = skillDisplayMetadata({ metadata: { eduwork: {
    displayName: '机构联网搜索与浏览', displayDescription: '使用机构搜索服务查找资料，通过官方浏览器阅读网页。',
  } } })
  const [row] = skillCenterRows([{ name: 'browser', description: 'Model-facing instructions', source: 'builtin',
    ...display, available: false, requirement: '请登录机构账号' }], { disabled: ['browser'] })
  assert.equal(row.label, display.displayName)
  assert.equal(row.description, display.displayDescription)
  assert.equal(row.name, 'browser')
  assert.equal(row.group, 'research')
  assert.equal(row.enabled, false)
  assert.equal(row.available, false)
  assert.equal(row.requirement, '请登录机构账号')
})

test('unannotated built-in and personal skills keep their existing labels and descriptions', () => {
  const rows = skillCenterRows([
    { name: 'browser', description: 'English model description', source: 'builtin',
      ...skillDisplayMetadata({ metadata: { eduwork: { displayName: '  ', displayDescription: false } } }) },
    { name: 'my-skill', description: '我的个人技能', source: 'personal' },
  ])
  const browser = rows.find(row => row.name === 'browser')
  assert.equal(browser.label, '网页搜索与浏览')
  assert.equal(browser.description, '查找互联网公开资料、阅读网页并操作网站。')
  assert.equal(rows.find(row => row.name === 'my-skill').description, '我的个人技能')
})

test('the real catalog and strict RPC codec preserve publisher display fields', { skip: !runtime }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-skill-display-'))
  const previous = process.env.DSH_BUNDLED_SKILL_DIR
  process.env.DSH_BUNDLED_SKILL_DIR = root
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_BUNDLED_SKILL_DIR
    else process.env.DSH_BUNDLED_SKILL_DIR = previous
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(join(root, 'browser'))
  await writeFile(join(root, 'browser', 'SKILL.md'), [
    '---', 'name: browser', 'description: Model-facing browser guidance',
    'metadata:', '  eduwork:', '    displayName: 机构联网搜索与浏览',
    '    displayDescription: 使用机构搜索服务与官方浏览器。', '---', '', '# Browser',
  ].join('\n'))
  const { default: Workbench } = await import('../lib/index.js')
  const { descriptors } = await import('../lib/typert-schemas.js')
  const catalog = await Workbench.prototype.catalog.call({ ctx: {
    skillManager: { list: async () => ({ skills: [] }) }, get: () => undefined,
  } })
  const codec = descriptors.find(row => row.method === 'catalog').result
  const transported = codec.schema.parse(JSON.parse(JSON.stringify(catalog)))
  assert.equal(transported.skills[0].description, 'Model-facing browser guidance')
  const [row] = skillCenterRows(transported.skills)
  assert.equal(row.label, '机构联网搜索与浏览')
  assert.equal(row.description, '使用机构搜索服务与官方浏览器。')
})
