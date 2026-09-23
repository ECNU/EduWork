import assert from 'node:assert/strict'
import test from 'node:test'
import { feedbackURL, visibleComponents } from '../src/client/about.js'

test('feedback shares only public build facts with the public repository for both editions', () => {
  for (const productName of ['EduWork', 'EduWork@ECNU']) {
    const release = { productName, productVersion: '0.3.6-dev.fixture', dshVersion: '0.1.5-rc.2', platform: 'darwin-arm64', path: '/private/user', accessToken: 'private-token', endpoint: 'http://private.internal', logs: 'private-logs' }
    const url = new URL(feedbackURL(release))
    assert.equal(url.origin + url.pathname, 'https://github.com/ECNU/EduWork/issues/new')
    assert.equal(url.searchParams.get('template'), 'bug_report.yml')
    assert.equal(url.searchParams.get('environment'), `${productName} 0.3.6-dev.fixture\ndarwin-arm64\nDSH Core 0.1.5-rc.2`)
    assert.doesNotMatch(decodeURIComponent(url.href), /private/)
  }
})

test('old platform receipts remain readable without a duplicate product card', () => {
  const rows = [
    { id: 'desktop-shell', category: 'platform', version: 'product-version' },
    { id: 'dsh-core', category: 'platform', version: 'core-version' },
    { id: 'electron', category: 'runtime', version: 'electron-version' },
    { id: 'python', category: 'runtime', version: 'python-version' },
    { id: 'office-suite', category: 'capability' },
  ]
  const visible = visibleComponents(rows)
  assert.equal(visible.some(row => row.version === 'product-version'), false)
  assert.deepEqual(visible.map(row => row.category), ['runtime', 'runtime', 'runtime', 'capability'])
  assert.equal(rows[1].category, 'platform')
})
