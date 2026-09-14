import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {mindmapFixture} from './fixtures/mindmap-data.mjs'
import {layoutMindmap,mindmapSVG,mindmapMarkdown,mindmapTree} from '../lib/mindmap.js'
import {normalizeParameters,ArtifactEngine,ArtifactStore} from '../lib/artifacts.js'
import {artifactRequest,studioInstructions} from '../lib/studio-instructions.js'
import {BUILTIN_CAPABILITIES} from '../lib/capabilities.js'
import {exportDocument} from '../lib/studio-export.js'

test('mindmap layout preserves deep and legacy nodes, connects parents, and fits every label without overlap',()=>{
 for(const legacy of [false,true]) {
  const artifact=mindmapFixture({legacy}),before=JSON.stringify(artifact),layout=layoutMindmap(artifact.content)
  assert.equal(layout.nodes.length,artifact.content.nodes.length);assert.equal(layout.edges.length,layout.nodes.length-1)
  for(const node of layout.nodes) {
   assert.ok(node.x>=0&&node.y>=0&&node.x+node.width<=layout.width&&node.y+node.height<=layout.height)
   assert.equal(node.lines.join(''),node.label)
   for(const other of layout.nodes.filter(other=>other.id!==node.id))assert.ok(node.x+node.width<=other.x||other.x+other.width<=node.x||node.y+node.height<=other.y||other.y+other.height<=node.y,'overlapping labels')
  }
  for(const edge of layout.edges)assert.equal(artifact.content.nodes.find(node=>node.id===edge.childId).parentId,edge.parentId)
  assert.equal(JSON.stringify(artifact),before)
 }
})

test('collapsed views omit descendants but complete SVG and nested Markdown preserve them and their sources',async()=>{
 const artifact=mindmapFixture(),layout=layoutMindmap(artifact.content,{collapsed:['services']})
 assert.ok(!layout.nodes.some(node=>node.id==='inclusive'))
 const svg=mindmapSVG(artifact.content),markdown=mindmapMarkdown(artifact)
 assert.equal((svg.match(/data-mindmap-node=/g)||[]).length,17);assert.equal((svg.match(/data-mindmap-edge=/g)||[]).length,16)
 assert.match(markdown,/^        - \*\*面向不同使用者/m);assert.match(markdown,/来源：synthetic-notes.md/)
 const directory=await mkdtemp(join(tmpdir(),'mindmap-exports-'))
 for(const format of ['md','svg','json']){const file=await exportDocument(artifact,directory,format);const value=await readFile(file.path,'utf8');assert.ok(value.includes('服务设计'));if(format==='json')assert.deepEqual(JSON.parse(value).content,artifact.content)}
 const malicious={nodes:[{id:'x"',label:'<script>&文本',body:'https://example.com/private'}]}
 const safe=mindmapSVG(malicious);assert.ok(!safe.includes('<script>'));assert.ok(!/href=|foreignObject|<image/.test(safe));assert.match(safe,/&lt;script&gt;/)
})

test('legacy forests and malformed parent links remain finite without changing persisted content',()=>{
 const content={nodes:[{id:'a',parentId:'b',label:'A'},{id:'b',parentId:'a',label:'B'},{id:'c',parentId:'missing',label:'C'}]},before=JSON.stringify(content)
 assert.equal(mindmapTree(content).nodes.length,3);assert.equal(layoutMindmap(content).total,3);assert.equal(JSON.stringify(content),before)
})

test('mindmap requests filter unrelated media defaults and selected-node questions stay scoped',async()=>{
 const normalized=normalizeParameters('mindmap',{count:6,voice:'irrelevant',subtitles:true,template:'briefing',focus:'公共服务'})
 assert.deepEqual(normalized,{focus:'公共服务',language:'zh-CN',audience:'',detail:'auto'})
 const request=artifactRequest(BUILTIN_CAPABILITIES.find(item=>item.id==='mindmap'),{...normalized,count:6,voice:'irrelevant'})
 assert.match(request,/展开程度：按材料决定/);assert.doesNotMatch(request,/voice|count|音色|字幕|knowledge_studio|JSON/)
 const instructions=studioInstructions('mindmap',normalized);assert.match(instructions,/2～4层/);assert.doesNotMatch(instructions,/视频|音色|场景|报告/)
 const directory=await mkdtemp(join(tmpdir(),'mindmap-ask-')),artifact=mindmapFixture(),store=new ArtifactStore(join(directory,'artifacts.json'))
 const created=await store.create({id:artifact.workspaceId,title:'合成工作区'},'mindmap',normalized)
 await store.update(created.id,artifact)
 const engine=new ArtifactEngine({workspaceRegistry:{get:()=>null}},{},{artifactPath:join(directory,'artifacts.json')})
 const prompt=await engine.askPrompt(created.id,'inclusive')
 assert.match(prompt,/服务设计 → 服务渠道 → 线上办理/);assert.match(prompt,/synthetic-notes.md/);assert.doesNotMatch(prompt,/培训与交接/)
 await engine.close()
})
