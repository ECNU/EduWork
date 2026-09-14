import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const build = fs.readFileSync(path.join(root, 'build-client.ps1'), 'utf8')
const clientBundle = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')

test('conversation derivative changes locked product copy and one narrow child seam', () => {
  assert.deepEqual(manifest.chatecnuWork.replaces, ['@deepseek-ai/dsh-client-ui-conversation'])
  assert.equal(manifest.exports['./invariant'], undefined)
  assert.deepEqual(manifest.chatecnuWork.diffScope, ['package identity rebind', 'empty-conversation hero copy', 'release-channel badge', 'unified add-control child slot'])
  assert.match(manifest.chatecnuWork.sunsetWhen, /hero-copy/)
  assert.match(build, /今天想一起完成什么？/)
  assert.match(build, /release-policy\.mjs/)
  assert.match(build, /releaseIdentity\.badge\.zh/)
  assert.doesNotMatch(build, /正在分析图片并准备回答/)
  assert.doesNotMatch(build, /--chatecnu-logo-accent|chatecnu-hero-logo-shadow/)
  assert.match(clientBundle, /"hero\.preview": "(?:开发版|公测版|正式版)"/)
  assert.match(clientBundle, /t\("hero\.preview"\) === "" \? null/)
  assert.match(clientBundle, /conversation\.hero\.brand\.mark/)
  assert.doesNotMatch(clientBundle, /analyzingImage \? "正在分析图片并准备回答…"/)
  assert.doesNotMatch(clientBundle, /conversation\.details\.artifact/)
  assert.match(clientBundle, /conversation\.input\.add/)
  assert.equal(clientBundle.match(/^\s*"conversation\.input\.add": \{\s*$/gmu)?.length, 1)
  assert.match(clientBundle, /"conversation\.input\.add": \{\s*kind: "single",\s*scope: "session-maybe"/u)
  assert.match(clientBundle, /onAddImages: intakeImages/)
  assert.match(clientBundle, /insertReference: \(reference\) =>/)
  assert.match(clientBundle, /keyboard\.caretSpan\(\)/)
  assert.doesNotMatch(clientBundle, /start: snapshot\.draft\.length/)
  assert.match(clientBundle, /keyboard\.insertReference\(reference, \{/)
  assert.match(clientBundle, /draftRev: snapshot\.draftRev/)
  assert.match(clientBundle, /openCommands: onToggleCommandMenu/)
  assert.match(clientBundle, /fallback: \(0, react_jsx_runtime\.jsx\)\(HeroFish, \{ hovering \}\)/)
  assert.match(build, /Conversation copy compatibility anchor changed/)
})

test('conversation derivative registers its product-owned loader identity', () => {
  const productID = '@chatecnu-work/dsh-client-ui-conversation-brand'
  assert.match(build, /Conversation package identity anchor changed/)
  assert.match(clientBundle, new RegExp(`id: ["']${productID.replaceAll('/', '\\/')}["']`))
  assert.doesNotMatch(clientBundle, /id: ["']@deepseek-ai\/dsh-client-ui-conversation["']/)
})
