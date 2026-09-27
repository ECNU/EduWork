import test from 'node:test'
import assert from 'node:assert/strict'
import { startupFailurePage, updaterStartupError } from '../src/startup-failure.mjs'

const settings = { productName: 'Synthetic EduWork', version: '0.0.0-test', config: 'C:\\Synthetic\\config\\eduwork.jsonc' }
const executable = 'C:\\Synthetic with spaces\\resources\\update\\EduWork-Updater.exe'
const failure = code => updaterStartupError(executable, Object.assign(Error(`spawn ${executable} ${code}`), { code }))

test('permission denial identifies the component, gives recovery steps and copyable diagnostics', () => {
  const page = startupFailurePage({ ...settings, error: failure('EACCES') })
  assert.match(page.html, /Windows 拒绝运行更新组件/)
  for (const text of ['拦截记录', '执行权限', '修复后重试', '复制错误信息', '打开组件目录']) assert.ok(page.html.includes(text))
  assert.ok(!page.html.includes('配置文件：'))
  assert.ok(!page.html.includes(settings.config))
  assert.ok(!page.html.includes('继续启动'))
  assert.match(page.html, /<details><summary>技术详情（EACCES）/)
  for (const text of [settings.productName, settings.version, executable, 'EACCES', `spawn ${executable} EACCES`]) assert.ok(page.diagnostics.includes(text))
})

test('missing and unknown executable failures do not claim an OS denial or proven corruption', () => {
  const missing = startupFailurePage({ ...settings, error: failure('ENOENT') })
  assert.match(missing.html, /系统未找到更新组件/)
  assert.doesNotMatch(missing.html, /Windows 拒绝运行/)
  const unknown = startupFailurePage({ ...settings, error: failure('UNKNOWN') })
  assert.match(unknown.html, /系统未能运行更新组件/)
  assert.doesNotMatch(unknown.html, /文件已损坏|Windows 拒绝运行|系统未找到更新组件/)
})

test('additional rollback errors preserve component-specific guidance and diagnostic context', () => {
  const error = new Error('Synthetic rollback write failed', { cause: failure('EPERM') })
  const page = startupFailurePage({ ...settings, error })
  assert.equal(page.executable, executable)
  assert.match(page.html, /Windows 拒绝运行更新组件/)
  assert.match(page.diagnostics, /Synthetic rollback write failed/)
  assert.match(page.diagnostics, /EPERM/)
})

test('paths, product names and errors are escaped, while copied diagnostics preserve literal text', () => {
  const payload = '<script>alert("synthetic")</script>&'
  const page = startupFailurePage({ ...settings, productName: payload, error: updaterStartupError(executable + payload, Error(payload)) })
  assert.ok(!page.html.includes('<script>'))
  assert.ok(page.html.includes('&lt;script&gt;'))
  assert.ok(page.diagnostics.includes(payload))
})

test('publisher bootstrap retains retry/import actions; generic configuration errors retain their original details', () => {
  const error = Object.assign(Error('Synthetic offline bootstrap'), { code: 'EDUWORK_BOOTSTRAP_REQUIRED' })
  const bootstrap = startupFailurePage({ ...settings, error })
  assert.equal(bootstrap.needsConfiguration, true)
  assert.match(bootstrap.html, /正在等待发行配置/)
  assert.match(bootstrap.html, /eduwork-startup:\/\/import\//)
  assert.match(bootstrap.html, /重试下载/)
  const generic = startupFailurePage({ ...settings, error: Error('Synthetic invalid configuration') })
  assert.match(generic.html, /Synthetic invalid configuration/)
  assert.ok(generic.html.includes(settings.config))
  for (const page of [bootstrap, generic]) {
    assert.equal(page.executable, undefined)
    assert.equal(page.diagnostics, undefined)
    assert.doesNotMatch(page.html, /eduwork-startup:\/\/(copy|component)\//)
  }
})
