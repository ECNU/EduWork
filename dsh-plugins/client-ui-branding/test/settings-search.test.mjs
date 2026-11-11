import test from 'node:test'
import assert from 'node:assert/strict'
import { searchSettings } from '../src/client/settings-search-index.js'
const rows = [{id:'models',label:'模型',order:2},{id:'eduwork-password-manager',label:'密码管理器',order:13},{id:'agent-presets',label:'Agent 预设',order:3}]
test('settings search handles Chinese, English aliases, case and multiple terms',()=>{
 assert.deepEqual(searchSettings(rows,'密码').map(x=>x.id),['eduwork-password-manager'])
 assert.deepEqual(searchSettings(rows,'  AUTOFill  ').map(x=>x.id),['eduwork-password-manager'])
 assert.deepEqual(searchSettings(rows,'agent 登录').map(x=>x.id),['eduwork-password-manager'])
 assert.deepEqual(searchSettings(rows,'API 密钥').map(x=>x.id),['models'])
 assert.deepEqual(searchSettings(rows,'missing'),[])
 assert.deepEqual(searchSettings(rows,''),[])
})
test('only registered sections appear and title matches precede keywords',()=>{
 assert.equal(searchSettings(rows.filter(x=>x.id!=='eduwork-password-manager'),'密码').length,0)
 assert.equal(searchSettings(rows,'Agent')[0].id,'agent-presets')
 assert.equal(rows.some(row=>'score' in row),false)
})
