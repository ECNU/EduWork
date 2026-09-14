// Bounded search wiring acceptance: actual pinned DSH Web/DeepSeek providers,
// real keyless browser search, and a local HTTP fixture for the keyed API route.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [productArg, outputArg] = process.argv.slice(2)
assert.ok(productArg && outputArg, 'Use <assembly> <evidence directory>')
const product = resolve(productArg), output = resolve(outputArg)
await mkdir(output, { recursive: true })
const require = createRequire(join(product, 'd/package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { WebRuntime } = await load('@deepseek-ai/dsh-web')
const auto = await load('@chatecnu-work/dsh-tool-browser/search-auto')
const composition = JSON.parse(await readFile(join(product, 'composition.json'), 'utf8'))
assert.equal(composition.find(row => row.id === 'web').config.searchProvider, 'eduwork-search')
assert.ok(composition.some(row => row.insert?.some(plugin => plugin.name.endsWith('/search-auto'))))
const ctx = new Context()
const fiber = await ctx.plugin(WebRuntime, { searchProvider: 'eduwork-search' })
let settings = {}, key, requests = 0
const cleanups = []
auto.apply({ web: ctx.web, get(name) {
  if (name === 'settings') return { get: () => settings }
  if (name === 'credentials') return { resolve: async ref => { assert.equal(ref, 'DEEPSEEK_API_KEY'); return key ? {value:key} : undefined } }
}, effect(factory) { cleanups.push(factory()) } })
const fixture = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks))
  assert.equal(request.url, '/messages')
  assert.equal(request.headers['x-api-key'], 'fixture-search-only')
  assert.equal(body.tools[0].type, 'web_search_20250305')
  requests++
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({content:[{type:'web_search_tool_result', content:[
    {type:'web_search_result',title:'Synthetic provider result',url:'https://example.org/result'},
    {type:'web_search_result',title:'Second synthetic result',url:'https://example.org/second'},
  ]}]}))
})
await new Promise(accept => fixture.listen(0, '127.0.0.1', accept))
const checks = [], report = {passed:false,checks, scope:'Pinned providers; real browser network; keyed route uses a local API fixture, not a paid DeepSeek request'}
try {
  const browser = await ctx.web.search({query:'DeepSeek Harness GitHub',maxResults:3}, AbortSignal.timeout(75000))
  assert.ok(browser.sources.length > 0, 'Browser engines returned no usable search sources')
  assert.equal(requests, 0)
  checks.push({name:'keyless-browser-search', sources:browser.sources.length, urls:browser.sources.map(source => source.url)})
  settings = {baseURL:`http://127.0.0.1:${fixture.address().port}`}; key='fixture-search-only'
  const official = await ctx.web.search({query:'synthetic query',maxResults:1})
  assert.equal(requests,1); assert.equal(official.sources.length,1); assert.equal(official.truncated,true)
  assert.equal(official.sources[0].url,'https://example.org/result')
  checks.push({name:'official-deepseek-http-provider',requests,cappedByOfficialWeb:true})
  key=undefined
  const back = await ctx.web.search({query:'DeepSeek Harness GitHub',maxResults:1}, AbortSignal.timeout(75000))
  assert.ok(back.sources.length > 0); assert.equal(requests,1)
  checks.push({name:'remove-key-returns-to-browser',sources:back.sources.length})
  report.passed=true
} catch(error) { report.error=error.message; process.exitCode=1 }
finally {
  for(const cleanup of cleanups) await cleanup?.()
  await fiber.dispose()
  await new Promise(accept=>fixture.close(accept))
  await writeFile(join(output,'result.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report))
}
