import assert from 'node:assert/strict'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {mkdir,writeFile} from 'node:fs/promises'
import {installKnowledgeStudioTools} from '../lib/tools.js'
import {apply as installOfficeTools} from '../packages/artifact-services/lib/office-tools.js'
import {installMediaTools} from '../packages/artifact-services/lib/media-tools.js'
assert.ok(process.env.STUDIO_TEST_DSH_RUNTIME)
const runtime=resolve(process.env.STUDIO_TEST_DSH_RUNTIME,'node_modules/@deepseek-ai')
const {Context}=await import(pathToFileURL(join(runtime,'cordis/lib/index.js')))
const {default:SystemPrompt}=await import(pathToFileURL(join(runtime,'dsh-system-prompt/lib/index.js')))
const {default:ToolRuntime}=await import(pathToFileURL(join(runtime,'dsh-tools/lib/index.js')))
const results=[]
for(const indexedRetrievalTools of [false,true]) {
 const ctx=new Context()
 await ctx.plugin(SystemPrompt,{})
 await ctx.plugin(ToolRuntime,{mode:'native'})
 installKnowledgeStudioTools(ctx,{}, {},{indexedRetrievalTools})
 installOfficeTools(ctx)
 installMediaTools(ctx,{})
 const schemas=ctx.tools.schemas()
 const studio=schemas.filter(x=>x.name.startsWith('knowledge_studio_')).map(x=>x.name).sort()
 assert.equal(studio.length,indexedRetrievalTools?5:1)
 assert.ok(studio.includes('knowledge_studio_create_artifact'))
 for(const name of ['office_document','office_spreadsheet','office_presentation','office_pdf','media_render']) {
   const schema=schemas.find(x=>x.name===name)
   assert.ok(schema,name)
   assert.equal(schema.parameters.properties.spec.type,'object')
   assert.equal(schema.parameters.properties.spec_json.type,'string')
 }
 results.push({indexedRetrievalTools,studio,schemas})
 // This isolated registry creates no workers or external resources.
}
const output=resolve('dist/stage-tool-catalog');await mkdir(output,{recursive:true})
await writeFile(join(output,'result.json'),JSON.stringify({passed:true,results},null,2))
console.log(JSON.stringify({passed:true,output,checks:['actual host ToolRuntime schemas','default and explicitly enabled index tools','object and legacy specs registered']}))
