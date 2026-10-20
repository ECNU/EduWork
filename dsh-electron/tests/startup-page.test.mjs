import test from 'node:test'
import assert from 'node:assert/strict'
import { startupPage } from '../src/startup-page.mjs'

const page = options => startupPage({ productName: 'EduWork', logo: 'data:image/png;base64,AA==',
  background: '#faf8f4', accent: '#9f2636', ...options })

test('ordinary startup copy is the default progress message', () => {
  assert.match(page({}), /正在准备本机工作环境…/)
})

test('required first-run work can supply its own status text', () => {
  const html = page({ message: '首次启动，正在下载并校验发行配置…' })
  assert.match(html, /<p role="status">首次启动，正在下载并校验发行配置…<\/p>/)
  assert.match(html, /aria-label="首次启动，正在下载并校验发行配置…"/)
})

test('product and status text stay escaped', () => {
  const html = page({ productName: '<img src=x onerror=alert(1)>', message: '<script>alert(1)</script>' })
  assert.doesNotMatch(html, /<img src=x|<script>alert/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
})
