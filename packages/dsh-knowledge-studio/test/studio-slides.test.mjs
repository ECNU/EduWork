import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import JSZip from 'jszip'
import {slidesFixture} from './fixtures/slides-data.mjs'
import {officeSpec} from '../lib/office-spec.js'
import {exportDocument} from '../lib/studio-export.js'
import {contentMarkdown,validateContent} from '../lib/studio-content.js'
import {normalizeParameters} from '../lib/artifacts.js'
import {renderOfficePreview} from '@eduwork/dsh-artifact-services/office-preview'
import {readPresentationDesign} from '@eduwork/dsh-artifact-services/office-design'

test('Studio consumes the exact design references used by the shared Office skill',async()=>{
  const documents=await readPresentationDesign()
  for(const document of documents)assert.equal(document.markdown,await readFile(new URL('../packages/artifact-services/skills/presentations/references/'+document.source.split('/').at(-1),import.meta.url),'utf8'))
  assert.match(documents[0].markdown,/two-column/);assert.match(documents[1].markdown,/modern-clean/)
  assert.ok(!documents.some(document=>document.markdown.includes('ask_user_question')))
})

test('Studio preserves the shared semantic presentation fields, selected theme, complete notes and references',async()=>{
  const artifact=slidesFixture(),spec=officeSpec(artifact)
  assert.equal(spec.theme,'digital-tech')
  assert.equal(new Set(spec.slides.map(slide=>slide.layout)).size,8)
  const directory=await mkdtemp(join(tmpdir(),'studio-semantic-slides-'))
  const pptx=await exportDocument(artifact,directory,'pptx'),bytes=await readFile(pptx.path),zip=await JSZip.loadAsync(bytes)
  assert.equal(Object.keys(zip.files).filter(path=>/^ppt\/slides\/slide\d+\.xml$/.test(path)).length,8)
  for(let index=0;index<8;index++) {
    const note=await zip.file(`ppt/notesSlides/notesSlide${index+1}.xml`).async('string')
    assert.ok(note.includes(artifact.content.slides[index].notes));assert.ok(note.includes('synthetic-notes.md'))
    const xml=await zip.file(`ppt/slides/slide${index+1}.xml`).async('string')
    assert.ok(xml.includes(artifact.content.slides[index].title))
    assert.ok(!xml.includes('讲稿'));assert.ok(!xml.includes('synthetic-notes.md'))
  }
  // Change stored content only: a file preview must still show the actual bytes.
  const changed={...artifact,exports:[pptx],content:{slides:[{heading:'这一行不在 PPTX 中',bullets:[]}]}}
  const html=await readFile((await exportDocument(changed,directory,'html')).path,'utf8')
  assert.equal(html,(await renderOfficePreview(pptx.path)).html)
  assert.ok(!html.includes('这一行不在 PPTX 中'));assert.match(html,/三个渠道承接不同需求/)
  assert.deepEqual(await readFile(pptx.path),bytes)
  const markdown=contentMarkdown(artifact)
  for(const term of ['线上办理','服务入口','第一阶段','明确责任',artifact.content.slides[0].notes,'synthetic-notes.md'])assert.ok(markdown.includes(term),term)
})

test('legacy slides remain readable and unrelated optional metadata does not block export',()=>{
  const legacy={kind:'slides',title:'old',content:{slides:[{id:'item1',heading:'旧标题',bullets:['旧要点'],notes:'旧讲稿',narration:'',evidenceIds:[]}]},citations:[]}
  assert.deepEqual(officeSpec(legacy).slides,[{layout:'summary',title:'旧标题',bullets:['旧要点'],speaker_notes:'旧讲稿'}])
  const fixture=slidesFixture(),raw=structuredClone(fixture.content)
  raw.slides[0].unexpected='must survive in draft'
  assert.equal(Object.hasOwn(validateContent('slides',JSON.stringify(raw),fixture.citations).slides[0],'unexpected'),false)
  assert.equal(normalizeParameters('slides',{theme:'warm-education',count:30}).count,30)
  assert.throws(()=>normalizeParameters('slides',{theme:'missing'}),/主题/)
  assert.throws(()=>normalizeParameters('slides',{count:41}),/1～40/)
})
