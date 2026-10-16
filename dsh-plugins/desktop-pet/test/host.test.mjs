import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Real Cordis and typert Runtime from a prepared product `d` directory.
const runtime = process.env.EDUWORK_TEST_RUNTIME
test('the Host plugin sends validated settings, lists built-in skins and closes the pet on dispose', { skip: !runtime }, async t => {
  const req = createRequire(join(runtime, 'package.json'))
  const { Context, Service } = await import(pathToFileURL(req.resolve('@deepseek-ai/cordis')))
  const hook = registerHooks({ resolve(name, context, next) {
    return next(name, /^(@deepseek-ai\/|zod$)/.test(name) ? { ...context, parentURL: pathToFileURL(join(runtime, 'package.json')).href } : context)
  } })
  const { default: DesktopPet } = await import('../lib/index.js')
  hook.deregister()
  const calls = []
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const desktop = new Service(ctx, 'desktopServices')
  desktop.pet = async body => { calls.push(body); return body.action === 'configure' ? { supported: true, shown: body.enabled } : { supported: true } }
  const fiber = ctx.plugin(DesktopPet, { enabled: true, skin: 'no-such-skin', size: 120 })
  await fiber
  await ctx.desktopPet.applied
  assert.deepEqual(calls[0], { action: 'configure', enabled: true, skin: 'eduwork-page', frame: { width: 192, height: 208 }, size: 120, bubbles: true, sleep: true })
  const status = await ctx.desktopPet.status()
  assert.equal(status.supported, true)
  assert.deepEqual(status.skins.map(skin => [skin.id, skin.name['zh-CN'], skin.author]), [
    ['eduwork-page', '小页', 'EduWork contributors'], ['eduwork-page-blue', '小页（蓝）', 'EduWork contributors'],
    ['dafeiyu', '大肥鱼', 'ZipZipPipe (character); whale-girl (vlln)'],
    ['ecnu-huashi', '小花狮', 'EduWork contributors (drawing); character © East China Normal University']])
  assert.match(status.skins[0].preview.src, /^data:image\/svg\+xml;base64,/)
  assert.deepEqual(await ctx.desktopPet.resetPosition(), { supported: true })
  assert.deepEqual(calls.at(-1), { action: 'reset-position' })
  await fiber.dispose()
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(calls.at(-1).enabled, false)
})
