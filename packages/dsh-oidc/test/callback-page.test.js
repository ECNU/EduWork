import assert from 'node:assert/strict'
import test from 'node:test'
import { callbackLanguage, callbackPage } from '../src/host/callback-page.js'
import { fixture } from './helpers/desktop-fixture.js'

test('callback page uses branded bilingual content, system fonts and a nonce-only style policy', () => {
  const profile = { displayName: 'Example', brand: { productName: 'EduWork <Test>', organizationName: 'School & Company', mark: 'E', primaryColor: '#345678' } }
  const page = callbackPage(profile, 'completed', 'zh-CN')
  assert.match(page.html, /lang="zh-CN"/)
  assert.match(page.html, /EduWork &lt;Test&gt;/)
  assert.match(page.html, /School &amp; Company/)
  assert.match(page.html, /身份认证已完成/)
  assert.match(page.html, /返回应用/)
  assert.match(page.html, /#345678/)
  assert.doesNotMatch(page.html, /<script|@import|fonts\.google|onclick=/)
  const nonce = page.html.match(/<style nonce="([^"]+)"/)[1]
  assert.ok(page.headers['content-security-policy'].includes(`style-src 'nonce-${nonce}'`))
  assert.equal(page.headers['cache-control'], 'no-store')
  assert.equal(page.headers['referrer-policy'], 'no-referrer')
  assert.match(callbackPage(profile, 'failed', 'en').html, /Sign-in did not complete/)
  assert.match(callbackPage(profile, 'expired', 'en').html, /has expired/)
  assert.match(callbackPage(profile, 'issuer-invalid', 'en').html, /Contact your administrator/)
  assert.match(callbackPage(profile, 'issuer-invalid', 'zh-CN').html, /联系管理员/)
  assert.equal(callbackLanguage('en-US,en;q=0.9,zh-CN;q=0.8'), 'en')
  assert.equal(callbackLanguage('fr;q=1,zh-CN;q=0.9,en;q=0.8'), 'zh-CN')
  assert.equal(callbackLanguage('zh;q=0,en;q=1'), 'en')
})

test('callback brand never injects markup or arbitrary image URLs', () => {
  const page = callbackPage({ brand: { productName: '<img src=x onerror=alert(1)>', mark: '<x>', primaryColor: 'red;}</style><script>', logoURL: 'javascript:alert(1)' } }, 'failed')
  assert.doesNotMatch(page.html, /<script>|<img src=x|src="javascript:/)
  assert.ok(page.headers['content-security-policy'].includes("img-src 'none'"))
  const logo = callbackPage({ brand: { logoURL: 'https://brand.example.edu/logo.png' } })
  assert.match(logo.html, /referrerpolicy="no-referrer"/)
  assert.ok(logo.headers['content-security-policy'].includes('img-src https://brand.example.edu'))
})

for (const wrongNonce of [false, true]) test(`HTTP callback ${wrongNonce ? 'failure' : 'success'} uses profile branding and omits authorization secrets`, async t => {
  const f = await fixture(t, { wrongNonce, resources: true, brand: { productName: 'EduWork Test', mark: 'E' } })
  const { callback } = await f.authorization()
  const response = await fetch(callback, { headers: { 'accept-language': 'zh-CN,zh;q=0.9' } })
  assert.equal(response.status, wrongNonce ? 400 : 200)
  const html = await response.text(), url = new URL(callback)
  assert.match(html, /EduWork Test/)
  assert.match(html, wrongNonce ? /此次登录未完成/ : /返回应用继续工作/)
  for (const secret of [url.searchParams.get('state'), '<ACCESS_TOKEN>', 'fixture-managed-key']) assert.equal(html.includes(secret), false)
  assert.doesNotMatch(html, /state=|code=|error_description|id_token|access_token/)
})
