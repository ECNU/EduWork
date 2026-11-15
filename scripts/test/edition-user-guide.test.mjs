import assert from 'node:assert/strict'
import test from 'node:test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEditionUserGuide } from '../build-edition-user-guide.mjs'
import { GUIDE_ROOT, withTheme } from '../../dsh-plugins/user-guide/lib/serve.js'

test('assembly keeps the public guide and builds the edition handbook offline', {
  skip: !process.env.EDUWORK_TEST_RUNTIME && 'requires the assembled DSH runtime',
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-guide-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const edition = join(root, 'edition'), out = join(root, 'guide'), runtime = process.env.EDUWORK_TEST_RUNTIME
  await mkdir(join(edition, 'docs'), { recursive: true })
  await cp(GUIDE_ROOT, out, { recursive: true })
  const original = await readFile(join(out, 'index.html'), 'utf8')
  await buildEditionUserGuide(edition, undefined, runtime, out)
  assert.equal(await readFile(join(out, 'index.html'), 'utf8'), original)
  const guide = { source: 'docs/guide.md', sourceUrl: 'https://example.org/edition/blob/main/docs/guide.md' }
  await writeFile(join(edition, guide.source), [
    '# Campus guide', '', '## Sign in', '', '[Support](help.md)', '', '![Login](login.png)', '',
    '| Plan | Limit |', '| --- | --- |', '| Student | 10 |', '', '<script>alert(1)</script>',
  ].join('\n'))
  await writeFile(join(edition, 'docs/login.png'), Buffer.from([137, 80, 78, 71]))
  await buildEditionUserGuide(edition, guide, runtime, out)
  const page = await readFile(join(out, 'index.html'), 'utf8')
  assert.match(page, /<h1>Campus guide<\/h1>/)
  assert.match(page, /<table>/)
  assert.match(page, /data:image\/png;base64,iVBORw==/)
  assert.match(page, /href="https:\/\/example.org\/edition\/blob\/main\/docs\/help.md" target="_blank"/)
  assert.doesNotMatch(page, /<script\b/i)
  assert.match(String(withTheme(page, 'dark')), /general\.html\?theme=dark/)
  const common = await readFile(join(out, 'general.html'), 'utf8')
  assert.match(common, /认识 EduWork/)
  assert.match(String(withTheme(common, 'light')), /index\.html\?theme=light/)
  await buildEditionUserGuide(edition, guide, runtime, out)
  assert.equal(await readFile(join(out, 'index.html'), 'utf8'), page)
  await writeFile(join(edition, guide.source), '# Missing illustration\n\n![Login](missing.png)')
  await assert.rejects(buildEditionUserGuide(edition, guide, runtime, out), { code: 'ENOENT' })
})
