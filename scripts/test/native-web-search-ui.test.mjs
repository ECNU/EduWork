import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {runInNewContext} from 'node:vm'
import test from 'node:test'
import {adaptNativeWebSearchUI} from '../native-web-search-ui.mjs'

const client=await readFile(new URL('../../dsh-plugins/client-ui-web-search-product/lib/client.js',import.meta.url),'utf8')
let Controller
// Exercise the actual shipped controller; exposing it is limited to this VM.
runInNewContext(client.replace('exports.NS = NS;','exports.Controller = WebSearchCardController; exports.NS = NS;'),{
  window:{__ModuleLoader__:{load({factory}){Controller=factory(()=>({})).Controller}}},
})
function select(base,enabled){
  const changes={}
  const controller=Object.create(Controller.prototype)
  controller.scopes={web:{getSnapshot:()=>({base})}}
  controller.selection={actions:()=>({resetField:key=>{changes[key]='reset'},edit:(key,value)=>{changes[key]=value}})}
  controller.select(enabled)
  return changes
}

test('disabling explicit API selection restores each deployment default',()=>{
  assert.deepEqual(select({searchProvider:'eduwork-search',fetchProvider:'http'},false),{searchProvider:'reset',fetchProvider:'reset'})
  assert.deepEqual(select({searchProvider:'institution-search',fetchProvider:'institution-fetch'},false),{searchProvider:'reset',fetchProvider:'reset'})
  assert.deepEqual(select({searchProvider:'eduwork-search',fetchProvider:'http'},true),{searchProvider:'deepseek-search-api',fetchProvider:'deepseek-fetch-api'})
})
test('a default API route can still be explicitly turned off',()=>{
  assert.deepEqual(select({searchProvider:'deepseek-search-api',fetchProvider:'deepseek-fetch-api'},true),{searchProvider:'reset',fetchProvider:'reset'})
  assert.deepEqual(select({searchProvider:'deepseek-search-api',fetchProvider:'deepseek-fetch-api'},false),{searchProvider:'deepseek-official',fetchProvider:'http'})
  assert.deepEqual(select(undefined,false),{searchProvider:'deepseek-official',fetchProvider:'http'})
})
test('upstream changes cannot silently bypass the reviewed adapter',()=>{
  assert.throws(()=>adaptNativeWebSearchUI('unreviewed client'),/anchor changed/)
  assert.throws(()=>adaptNativeWebSearchUI(client),/anchor changed/)
})
