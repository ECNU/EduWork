import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configureProductConcurrency } from '../../scripts/configure-product-concurrency.mjs'
test('assembled workflow setting preserves expressions and nested config', {skip:!process.env.EDUWORK_TEST_RUNTIME}, async t=>{
 const root=await mkdtemp(join(tmpdir(),'eduwork-workflow-budget-'));t.after(()=>rm(root,{recursive:true,force:true}))
 await mkdir(join(root,'presets/standard'),{recursive:true})
 await symlink(join(process.env.EDUWORK_TEST_RUNTIME,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir')
 const file=join(root,'presets/standard/agent.cordis.yml')
 await writeFile(file,"# source comment\n- id: group\n  config:\n    - name: '@deepseek-ai/dsh-workflow-worker-thread'\n      config:\n        provider: spawn\n    - name: platform-tool\n      disabled: !!js process.platform !== 'win32'\n")
 assert.equal((await configureProductConcurrency(root)).workflowProviders,1)
 const text=await readFile(file,'utf8')
 assert.match(text,/maxConcurrentAgents: 2/);assert.match(text,/provider: spawn/)
 assert.match(text,/disabled: !!js process.platform !== 'win32'/);assert.match(text,/# source comment/)
 await configureProductConcurrency(root);assert.equal(await readFile(file,'utf8'),text)
})
