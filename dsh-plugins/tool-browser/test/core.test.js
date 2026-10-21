import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { browserExecutable, browserPresentationMeta, compactText, directSearchResultURL, isCiteableSearchResultURL, isPrivateTarget, isSearchResultRelevant, normalizeURL, resolvesToPrivateTarget, searchQueryTokens, searchURL, untrustedPage, webSearchResult } from '../lib/core.js'

test('portable browser works without a system browser and follows relocated resources', t => {
  const root = mkdtempSync(join(tmpdir(), 'eduwork-browser-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const before = join(root, '原位置 chrome.exe'), after = join(root, '移动后 chrome.exe')
  writeFileSync(before, 'synthetic browser')
  const environment = { DSH_MEDIA_BROWSER: before }
  assert.equal(browserExecutable(undefined, { environment, platform: 'win32' }), before)
  renameSync(before, after)
  environment.DSH_MEDIA_BROWSER = after
  assert.equal(browserExecutable(undefined, { environment, platform: 'win32' }), after)
  environment.DSH_MEDIA_BROWSER = root
  assert.throws(() => browserExecutable(undefined, { environment, platform: 'win32' }), /No supported browser/)
})

test('browser overrides remain supported and Windows Chrome is discovered without Edge', t => {
  const root = mkdtempSync(join(tmpdir(), 'eduwork-browser-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const chrome = join(root, 'Google/Chrome/Application/chrome.exe'), bundled = join(root, 'bundled.exe')
  mkdirSync(dirname(chrome), { recursive: true }); writeFileSync(chrome, 'synthetic chrome'); writeFileSync(bundled, 'synthetic bundled browser')
  const environment = { LOCALAPPDATA: root }
  assert.equal(browserExecutable(undefined, { environment, platform: 'win32' }), chrome)
  environment.DSH_MEDIA_BROWSER = bundled
  assert.equal(browserExecutable(undefined, { environment, platform: 'win32' }), bundled)
  for (const key of ['EDUWORK_BROWSER_EXECUTABLE', 'CHATECNU_WORK_BROWSER_EXECUTABLE']) {
    environment[key] = chrome
    assert.equal(browserExecutable(undefined, { environment, platform: 'win32' }), chrome)
    delete environment[key]
  }
  assert.equal(browserExecutable(chrome, { environment, platform: 'win32' }), chrome)
})

test('normalizes public HTTP(S) URLs and rejects local file URLs', () => {
  assert.equal(normalizeURL('example.com/a'), 'https://example.com/a')
  assert.throws(() => normalizeURL('file:///c:/secret.txt'), /HTTP\(S\)/)
  assert.throws(() => normalizeURL('https://u:p@example.com'), /credentials/)
})

test('classifies private browser targets for approval', () => {
  assert.equal(isPrivateTarget('http://127.0.0.1:3000'), true)
  assert.equal(isPrivateTarget('http://192.168.1.2'), true)
  assert.equal(isPrivateTarget('https://www.ecnu.edu.cn'), false)
  for (const url of ['http://0.0.0.0/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'http://localhost./',
    'http://localhost.localdomain/', 'http://app.localhost/', 'http://nas.lan/', 'http://100.64.0.1/', 'http://router/',
    'http://[fe80::1]/', 'http://[fd00::1]/', 'http://[64:ff9b::a00:1]/', 'http://[2002:c0a8:101::]/']) {
    assert.equal(isPrivateTarget(url), true, url)
  }
  for (const url of ['http://8.8.8.8/', 'http://[2001:4860:4860::8888]/', 'http://[64:ff9b::808:808]/', 'http://[::ffff:808:808]/']) {
    assert.equal(isPrivateTarget(url), false, url)
  }
})

test('resolves hostnames before calling a target public', async () => {
  const answers = { 'public.example': ['93.184.215.14'], 'rebind.example': ['93.184.215.14', '127.0.0.1'], 'v6.example': ['::ffff:10.0.0.1'] }
  const lookup = async host => { if (!answers[host]) throw new Error('ENOTFOUND'); return answers[host].map(address => ({ address, family: address.includes(':') ? 6 : 4 })) }
  assert.equal(await resolvesToPrivateTarget('https://public.example/', { lookup }), false)
  assert.equal(await resolvesToPrivateTarget('https://rebind.example/', { lookup }), true)
  assert.equal(await resolvesToPrivateTarget('https://v6.example/', { lookup }), true)
  assert.equal(await resolvesToPrivateTarget('https://missing.example/', { lookup }), true)
  assert.equal(await resolvesToPrivateTarget('https://slow.example/', { lookup: () => new Promise(() => {}), timeoutMs: 10 }), true)
  assert.equal(await resolvesToPrivateTarget('http://8.8.8.8/', { lookup: () => { throw new Error('literal addresses are not looked up') } }), false)
})

test('creates encoded search URLs', () => {
  assert.match(searchURL('bing', '华东师范大学 agent'), /^https:\/\/www\.bing\.com\/search\?q=.*&setlang=zh-hans&cc=cn&mkt=zh-CN$/)
  assert.match(searchURL('baidu', 'ChatECNU'), /^https:\/\/m\.baidu\.com\/s\?word=/)
})

test('rejects stale search rows that are unrelated to the requested query', () => {
  assert.ok(searchQueryTokens('请搜索一下 华东师范大学 最新消息').includes('华东'))
  assert.equal(isSearchResultRelevant('华东师范大学', {
    title: '华东师范大学',
    url: 'https://www.ecnu.edu.cn/',
    snippet: '位于上海的高等学校',
  }), true)
  assert.equal(isSearchResultRelevant('华东师范大学', {
    title: 'Goblin Slayer - Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Goblin_Slayer',
    snippet: 'Japanese fantasy series',
  }), false)
  assert.equal(isSearchResultRelevant('DeepSeek Harness RC2', {
    title: 'DeepSeek Harness releases',
    url: 'https://github.com/deepseek-ai/deepseek-harness/releases',
    snippet: 'Release candidate RC2',
  }), true)
  assert.equal(isSearchResultRelevant('DeepSeek Harness RC2', {
    title: 'DeepSeek Platform',
    url: 'https://platform.deepseek.com/',
    snippet: 'Build with the DeepSeek API',
  }), false)
  assert.equal(isSearchResultRelevant('site:github.com/deepseek-ai/deepseek-harness releases rc2', {
    title: 'releases · GitHub Topics · GitHub',
    url: 'https://github.com/topics/releases',
    snippet: 'Browse popular releases repositories',
  }), false)
  assert.equal(isSearchResultRelevant('site:github.com/deepseek-ai/deepseek-harness releases rc2', {
    title: 'deepseek-harness releases',
    url: 'https://github.com/deepseek-ai/deepseek-harness/releases',
    snippet: 'Release candidate rc2',
  }), true)
})

test('keeps direct citation targets and rejects search-engine navigation URLs', () => {
  assert.equal(isCiteableSearchResultURL('https://www.ecnu.edu.cn/'), true)
  assert.equal(isCiteableSearchResultURL('https://baike.baidu.com/item/ecnu'), true)
  assert.equal(isCiteableSearchResultURL('https://m.baidu.com/from=0/tc?x=1'), false)
  assert.equal(isCiteableSearchResultURL('https://www.bing.com/ck/a?u=x'), false)
  assert.equal(isCiteableSearchResultURL('http://34689.recommend_list.baidu.com/'), false)
})

test('unwraps Bing result redirects into citeable destination URLs', () => {
  const destination = 'https://www.ecnu.edu.cn/'
  const encoded = Buffer.from(destination).toString('base64url')
  assert.equal(directSearchResultURL('bing', `https://www.bing.com/ck/a?u=a1${encoded}&ntb=1`), destination)
  assert.equal(directSearchResultURL('baidu', 'https://www.baidu.com/link?url=x'), 'https://www.baidu.com/link?url=x')
})

test('projects browser results into the official DSH web provider vocabulary', () => {
  assert.deepEqual(webSearchResult([
    { title: ' ECNU ', url: 'https://www.ecnu.edu.cn/', snippet: ' University ' },
    { title: 'duplicate', url: 'https://www.ecnu.edu.cn/', snippet: 'ignored' },
    { title: 'invalid', url: 'javascript:alert(1)', snippet: 'ignored' },
  ]), {
    sources: [{ title: 'ECNU', url: 'https://www.ecnu.edu.cn/', snippet: 'University' }],
    truncated: false,
  })
})

test('marks and bounds page content as untrusted', () => {
  const value = untrustedPage({ title: ' Demo ', url: 'https://example.com/', text: 'x'.repeat(20_000), links: [] })
  assert.equal(value.trust, 'untrusted-web-content')
  assert.ok(value.text.length < 20_000)
  assert.equal(compactText('a\n\n\n\n\nb'), 'a\n\n\nb')
})

test('browser presentation metadata is lossless JSON and omits absent fields', () => {
  const meta = browserPresentationMeta({ action: 'navigate', url: 'https://example.com/', title: undefined, path: undefined })
  assert.deepEqual(meta, { action: 'navigate', url: 'https://example.com/' })
  assert.deepEqual(JSON.parse(JSON.stringify(meta)), meta)
})
