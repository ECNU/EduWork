import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createMediaRuntime} from '../packages/artifact-services/lib/runtime.js'
import {runVideoCommand} from '../packages/artifact-services/lib/video-runner.js'

const base=resolve(process.env.STUDIO_TEMPLATE_OUTPUT||'dist/stage-video-templates')
await mkdir(base,{recursive:true})
const output=await mkdtemp(join(base,'run-')),runtime=await createMediaRuntime(),results=[]
await writeFile(join(output,'process.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}))
for(const template of ['editorial','archive-paper']) {
  const project=join(output,template);await mkdir(project)
  const created=await runVideoCommand('init',{'project-root':project,name:'sample'},runtime)
  const plan=JSON.parse(await readFile(created.plan,'utf8'))
  assert.equal(plan.template,'editorial')
  plan.template=template
  await writeFile(created.plan,JSON.stringify(plan,null,2))
  const rendered=await runVideoCommand('render',{'project-root':project,workspace:created.workspace},runtime)
  assert.equal(rendered.validation.rendered,true)
  results.push({template,...rendered})
}
await writeFile(join(output,'result.json'),JSON.stringify({passed:true,results,remoteCalls:0},null,2))
console.log(JSON.stringify({passed:true,output}))
