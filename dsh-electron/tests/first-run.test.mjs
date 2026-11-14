import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { firstRunPending, firstRunDialogs, resolveFirstRunData } from '../src/first-run.mjs'

test('first-run detection applies only to the Windows installed layout', async () => {
  const list = () => assert.fail('other layouts must not inspect the target')
  for (const [platform, dataLayout] of [['darwin', 'installed'], ['linux', 'installed'], ['win32', undefined], ['win32', 'portable']])
    assert.equal(await firstRunPending({ userRoot: 'unused', dataLayout, platform, list }), false)
})

test('first-run detection treats a missing or empty target as pending and existing data as reuse', async () => {
  const installed = { userRoot: 'C:\\Users\\测试 用户\\AppData\\Local\\EduWork\\eduwork', dataLayout: 'installed', platform: 'win32' }
  assert.equal(await firstRunPending({ ...installed, list: () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })) }), true)
  assert.equal(await firstRunPending({ ...installed, list: async () => [] }), true)
  assert.equal(await firstRunPending({ ...installed, list: async () => ['data'] }), false)
  assert.equal(await firstRunPending({ ...installed, list: async () => ['.eduwork-migration.json'] }), false)
  await assert.rejects(firstRunPending({ ...installed, list: () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })) }), /denied/)
})

test('first-run detection reads the real target directory', async t => {
  const base = await mkdtemp(join(tmpdir(), 'eduwork-first-run-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const userRoot = join(base, 'EduWork', 'eduwork')
  const installed = { userRoot, dataLayout: 'installed', platform: 'win32' }
  assert.equal(await firstRunPending(installed), true)
  await mkdir(userRoot, { recursive: true })
  assert.equal(await firstRunPending(installed), true)
  await writeFile(join(userRoot, 'marker'), 'x')
  assert.equal(await firstRunPending(installed), false)
})

function dialogFixture(responses) {
  const boxes = [], opens = []
  const dialogs = firstRunDialogs({ productName: 'EduWork 测试版',
    showMessageBox: async options => { boxes.push(options); return { response: responses.box.shift() } },
    showOpenDialog: async options => { opens.push(options); return responses.open.shift() } })
  return { dialogs, boxes, opens }
}

test('choice dialog offers import, fresh start and cancel with cancel as the escape default', async () => {
  const { dialogs, boxes } = dialogFixture({ box: [0, 1, 2], open: [] })
  assert.equal(await dialogs.choose(), 'import')
  assert.equal(await dialogs.choose(), 'fresh')
  assert.equal(await dialogs.choose(), 'cancel')
  assert.equal(boxes.length, 3)
  for (const options of boxes) {
    assert.deepEqual(options.buttons, ['选择旧目录导入', '全新开始', '取消'])
    assert.equal(options.cancelId, 2)
    assert.equal(options.defaultId, 0)
    assert.equal(options.noLink, true)
    assert.match(options.title, /EduWork 测试版/)
  }
})

test('directory picker selects a real directory and treats a closed dialog as no selection', async () => {
  const { dialogs, opens } = dialogFixture({ box: [], open: [
    { canceled: false, filePaths: ['D:\\旧 客户端\\EduWork'] },
    { canceled: true, filePaths: [] },
  ] })
  assert.equal(await dialogs.pickSource(), 'D:\\旧 客户端\\EduWork')
  assert.equal(await dialogs.pickSource(), undefined)
  for (const options of opens) {
    assert.deepEqual(options.properties, ['openDirectory'])
    assert.match(options.title, /EduWork 测试版/)
  }
})

test('import failure dialog keeps the source error visible and maps retry versus cancel', async () => {
  const { dialogs, boxes } = dialogFixture({ box: [0, 1], open: [] })
  assert.equal(await dialogs.importFailed(new Error('所选目录不是 EduWork 便携客户端（缺少 release.json）')), true)
  assert.equal(await dialogs.importFailed(new Error('旧客户端或其后台 Host 仍在运行')), false)
  assert.equal(boxes.length, 2)
  for (const [options, message] of [[boxes[0], '所选目录不是 EduWork 便携客户端（缺少 release.json）'], [boxes[1], '旧客户端或其后台 Host 仍在运行']]) {
    assert.equal(options.type, 'error')
    assert.deepEqual(options.buttons, ['重新选择', '取消'])
    assert.equal(options.cancelId, 1)
    assert.ok(options.detail.includes(message))
    assert.match(options.detail, /旧目录保持原样/)
  }
})

test('fresh start and cancel never open the picker or import', async () => {
  for (const choice of ['fresh', 'cancel']) {
    const result = await resolveFirstRunData({
      choose: async () => choice,
      pickSource: () => assert.fail('picker must stay closed'),
      importSource: () => assert.fail('import must not run'),
      importFailed: () => assert.fail('no failure to report'),
    })
    assert.deepEqual(result, { action: choice })
  }
})

test('a successful import returns the receipt and passes the selected directory to the shared validator', async () => {
  const receipt = { schemaVersion: 1, state: 'imported' }, imported = []
  const result = await resolveFirstRunData({
    choose: async () => 'import',
    pickSource: async () => 'D:\\旧 客户端\\EduWork',
    importSource: async sourceRoot => { imported.push(sourceRoot); return receipt },
    importFailed: () => assert.fail('import succeeded'),
  })
  assert.deepEqual(result, { action: 'imported', receipt })
  assert.deepEqual(imported, ['D:\\旧 客户端\\EduWork'])
})

test('a closed directory picker returns to the choice without importing', async () => {
  let choices = 0
  const result = await resolveFirstRunData({
    choose: async () => { choices++; return choices === 1 ? 'import' : 'fresh' },
    pickSource: async () => undefined,
    importSource: () => assert.fail('no directory was selected'),
    importFailed: () => assert.fail('no failure to report'),
  })
  assert.deepEqual(result, { action: 'fresh' })
  assert.equal(choices, 2)
})

test('import failure offers retry, and cancelling the error never falls back to an empty fresh start', async () => {
  const failure = new Error('目标用户目录已有数据'), seen = []
  let attempts = 0
  const result = await resolveFirstRunData({
    choose: async () => 'import',
    pickSource: async () => 'D:\\旧 客户端',
    importSource: async () => { attempts++; if (attempts === 1) throw failure; return { state: 'imported' } },
    importFailed: async error => { seen.push(error); return seen.length === 1 },
  })
  assert.deepEqual(result, { action: 'imported', receipt: { state: 'imported' } })
  assert.deepEqual(seen, [failure])
  assert.equal(attempts, 2)
  const cancelled = await resolveFirstRunData({
    choose: async () => 'import',
    pickSource: async () => 'D:\\旧 客户端',
    importSource: async () => { throw failure },
    importFailed: async () => false,
  })
  assert.deepEqual(cancelled, { action: 'cancel' })
})