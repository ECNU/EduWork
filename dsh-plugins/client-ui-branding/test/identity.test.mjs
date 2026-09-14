import assert from 'node:assert/strict'
import test from 'node:test'
import { genericMarkSVG, productIdentity } from '../src/identity.js'

test('new public profiles have a neutral identity without institution configuration', () => {
  assert.deepEqual(productIdentity(), { name: 'EduWork', logoUrl: '', styleLabels: { dsh: '蓝色', 'ecnu-liwa': '红色' } })
})

test('edition identity comes from composition while historical user branding cannot replace it', () => {
  const snapshot = {
    base: { product: { name: 'EduWork@Example', logoUrl: '/brand/example.svg', styleLabels: { 'ecnu-liwa': '学校红' } } },
    value: { product: { name: 'Old product', logoUrl: '/old.svg' }, visualStyle: 'dsh' },
    user: { product: { name: 'Old product' } },
  }
  assert.deepEqual(productIdentity(snapshot), {
    name: 'EduWork@Example', logoUrl: '/brand/example.svg', styleLabels: { dsh: '蓝色', 'ecnu-liwa': '学校红' },
  })
  assert.equal(snapshot.value.visualStyle, 'dsh')
})

test('logos admit explicit image assets without arbitrary protocols or implicit remote origins', () => {
  for (const logoUrl of ['javascript:alert(1)', 'file:///private/logo.svg', '//unknown.example/logo.svg', 'relative.svg']) {
    assert.equal(productIdentity({ base: { product: { logoUrl } } }).logoUrl, '')
  }
  for (const logoUrl of ['/brand/logo.svg', 'https://example.test/logo.png', 'data:image/svg+xml,%3Csvg/%3E']) {
    assert.equal(productIdentity({ base: { product: { logoUrl } } }).logoUrl, logoUrl)
  }
  assert.doesNotMatch(genericMarkSVG('" onload="alert(1)'), /onload|alert/)
  assert.match(genericMarkSVG('#9f2636'), /#9f2636/)
})
