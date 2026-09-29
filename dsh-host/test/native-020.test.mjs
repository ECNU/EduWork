import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { EventEmitter } from 'node:events'
import { adaptNativeDesktopSource } from '../../dsh-electron/scripts/native-desktop-source.mjs'
import { adaptNativeHostEntry, adaptNativeQuitInspection } from '../prepare-native.mjs'
import { distributionPolicy, disabledDistributionEntries } from '../distribution-policy.mjs'
import { writeNativeProfile, rewriteLiteraturePatchNames } from '../native-profile.mjs'

const upstream = process.env.EDUWORK_TEST_UPSTREAM
const source = file => readFile(join(upstream, file), 'utf8')
const code = ts => stripTypeScriptTypes(ts, { mode: 'transform' })

test('literature migrates guarded profile/home patches using official YAML and entry patch semantics', { skip: !process.env.EDUWORK_TEST_RUNTIME }, async t => {
  const require = createRequire(join(process.env.EDUWORK_TEST_RUNTIME, 'package.json'))
  const yaml = await import(pathToFileURL(require.resolve('yaml')).href)
  const { applyEntryPatches } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-include')).href)
  const home = await mkdtemp(join(tmpdir(), 'literature-guarded-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const profile = join(home, 'profiles/desktop-017')
  await mkdir(profile, { recursive: true })
  const before = '# preserve this comment\n- id: tool-literature\n  name: "@shlv/dsh-literature-tool"\n  disabled: true\n  config:\n    subagentProvider: custom\n    name: "@shlv/dsh-literature-core"\n- id: another\n  config: !!js "ctx.custom"\n'
  for (const folder of [home, profile]) await writeFile(join(folder, 'cordis.patch.yml'), before)
  const options = { profile, home, bundles: ['@eduwork/dsh-literature'], patches: [], yaml, parse: yaml.parse }
  await writeNativeProfile(options)
  for (const folder of [home, profile]) {
    const after = await readFile(join(folder, 'cordis.patch.yml'), 'utf8')
    assert.match(after, /# preserve this comment/)
    assert.match(after, /!!js/)
    const rows = yaml.parse(after, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] })
    assert.equal(rows[0].name, '@eduwork/dsh-literature/tool')
    assert.equal(rows[0].config.name, '@shlv/dsh-literature-core', 'business configuration is not a module selector')
    assert.equal(rows[1].config, 'ctx.custom')
    const effective = applyEntryPatches([{ id: 'tool-literature', name: '@eduwork/dsh-literature/tool' }], [rows[0]], assert.fail)
    assert.equal(effective[0].disabled, true)
    assert.equal(effective[0].config.subagentProvider, 'custom')
    const backups = (await readdir(folder)).filter(name => name.startsWith('cordis.patch.yml.before-literature-fork-'))
    assert.equal(backups.length, 1)
    assert.equal(await readFile(join(folder, backups[0]), 'utf8'), before)
    assert.equal(rewriteLiteraturePatchNames(after, yaml), after)
  }
  const nested = '- insert:\n    - id: custom\n      group: true\n      config:\n        - id: source\n          name: "@shlv/dsh-literature-arxiv"\n        - id: mine\n          name: "@other/literature"\n'
  const groups = yaml.parse(rewriteLiteraturePatchNames(nested, yaml))
  assert.equal(groups[0].insert[0].config[0].name, '@eduwork/dsh-literature/arxiv')
  assert.equal(groups[0].insert[0].config[1].name, '@other/literature')
  await writeNativeProfile(options)
})
test('official patch implementation keeps distribution policy above user enable/reload', { skip: !upstream }, async () => {
  const text = await source('vendor/include/src/index.ts')
  const start = text.indexOf('export function applyEntryPatches(')
  const apply = runInNewContext(code(text.slice(start, text.indexOf('\n}\n', start) + 3)).replace('export ', '') + '\napplyEntryPatches', { structuredClone })
  const rows = disabledDistributionEntries.map(id => ({ id, disabled: false }))
  for (let reload = 0; reload < 3; reload++) {
    const user = apply(rows, rows.map(row => ({ ...row, disabled: false })), assert.fail)
    const effective = apply(user, distributionPolicy(), assert.fail)
    assert.ok(effective.every(row => row.disabled))
    assert.ok(rows.every(row => !row.disabled), 'patching must not mutate source')
  }
  const entry = adaptNativeHostEntry(await source('apps/desktop-host/src/index.ts'))
  assert.match(entry, /patchFiles: \[join\(import.meta.dirname, 'distribution-policy.patch.json'\)\]/)
})
test('adapted official window still publishes fullscreen on Windows and macOS', { skip: !upstream }, async () => {
  const text = code(adaptNativeDesktopSource('apps/desktop/src/main.ts', await source('apps/desktop/src/main.ts')))
    .replace(/^import .*$/gm, '').replace('export function', 'function')
  for (const platform of ['win32', 'darwin']) {
    const messages = []
    class Window extends EventEmitter {
      webContents = Object.assign(new EventEmitter(), { send: (...args) => messages.push(args) })
      isDestroyed = () => false
      isFullScreen = () => true
    }
    const create = runInNewContext(text + '\ncreateWindow', { BrowserWindow: Window,
      app: { getLocale: () => 'zh-CN' }, resolveDesktopLocale: () => ({}), nativeTheme: { shouldUseDarkColors: false },
      process: { platform }, WINDOWS_TITLEBAR_HEIGHT: 40, DESKTOP_IPC: { windowFullscreen: 'fullscreen' },
    })
    const window = create('preload', true, true)
    window.emit('enter-full-screen'); window.emit('leave-full-screen'); window.webContents.emit('did-finish-load')
    assert.deepEqual(messages, [['fullscreen', true], ['fullscreen', true], ['fullscreen', true]])
  }
})
test('quit inspector sees official persisted schedules without a loaded Agent', { skip: !upstream || !process.env.EDUWORK_TEST_RUNTIME }, async () => {
  const text = code(adaptNativeQuitInspection(await source('apps/desktop-host/src/quit-inspection.ts')))
    .replace(/^import .*$/gm, '').replace('export function', 'function')
  const install = runInNewContext(text + '\ninstallDesktopQuitInspection', { hasDesktopActiveTasks: () => false })
  let dispose
  const require = createRequire(join(process.env.EDUWORK_TEST_RUNTIME, 'package.json'))
  const { ScheduleService } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-schedule')).href)
  const tasks = new Map([['cold', { sessionId: 'cold-session', status: 'active', record: { id: 'cold', scheduledAt: '2026-01-01' } }]])
  const store = { getDomain: async () => ({ table: () => tasks }) }
  const services = { agents: { list: () => [] }, jobs: {}, schedule: { catalog: () => ScheduleService.prototype.catalog.call(store) } }
  const inspect = install({ get: name => services[name], effect: setup => { dispose = setup() } })
  assert.equal((await inspect()).scheduledTasks, true)
  tasks.get('cold').status = 'inactive'
  assert.equal((await inspect()).scheduledTasks, false)
  delete services.schedule
  assert.equal((await inspect()).scheduledTasks, false)
  dispose(); await assert.rejects(inspect(), /stopping/)
})
