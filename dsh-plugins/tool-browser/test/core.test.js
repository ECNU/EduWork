import assert from 'node:assert/strict'
import test from 'node:test'
import { browserPresentationMeta, compactText, directSearchResultURL, isCiteableSearchResultURL, isPrivateTarget, isSearchResultRelevant, normalizeURL, searchQueryTokens, searchURL, untrustedPage, webSearchResult } from '../lib/core.js'

test('normalizes public HTTP(S) URLs and rejects local file URLs', () => {
  assert.equal(normalizeURL('example.com/a'), 'https://example.com/a')
  assert.throws(() => normalizeURL('file:///c:/secret.txt'), /HTTP\(S\)/)
  assert.throws(() => normalizeURL('https://u:p@example.com'), /credentials/)
})

test('classifies private browser targets for approval', () => {
  assert.equal(isPrivateTarget('http://127.0.0.1:3000'), true)
  assert.equal(isPrivateTarget('http://192.168.1.2'), true)
  assert.equal(isPrivateTarget('https://www.ecnu.edu.cn'), false)
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
