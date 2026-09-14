import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {mindmapFixture} from '../test/fixtures/mindmap-data.mjs'
// STUDIO_PACKAGE_ROOT permits the same probe to run against an installed tarball.
const root=resolve(process.env.STUDIO_PACKAGE_ROOT||'.'),out=resolve(process.env.STUDIO_EXPORT_OUTPUT||'dist/exports')
const {exportDocument}=await import(pathToFileURL(join(root,'lib/studio-export.js')))
const {videoPoster}=await import(pathToFileURL(join(root,'lib/video-poster.js')))
const {createRequire}=await import('node:module'),ownRequire=createRequire(join(root,'package.json'))
const {getMediaFFmpegPath}=await import(pathToFileURL(ownRequire.resolve('@eduwork/dsh-artifact-services/runtime')))
await mkdir(out,{recursive:true})
const report={id:'report',kind:'report',title:'Independent report',citations:[],content:{sections:[{heading:'Evidence',body:'Portable export verification. **Emphasis** and *context* remain readable.\n\n- Preserve source material\n- Review the final export\n\n| Check | Result |\n| --- | --- |\n| Headings | Structured |\n| Table | Preserved |',evidenceIds:[]}]}}
const deck={id:'slides',kind:'slides',title:'Independent slides',citations:[],content:{slides:[{heading:'First slide',bullets:['Portable files'],notes:'First notes'},{heading:'Second slide',bullets:['Shared runtime'],notes:'Second notes'}]}}
const files=[]
for(const artifact of [report,deck]) {
  const file=await exportDocument(artifact,out,'pdf')
  const inspected=JSON.parse(execFileSync(process.env.DSH_OFFICE_PYTHON,['-I','-c',"import json,sys; from pypdf import PdfReader; r=PdfReader(sys.argv[1]); print(json.dumps({'pages':len(r.pages),'text':' '.join(p.extract_text() for p in r.pages)}))",file.path],{encoding:'utf8',windowsHide:true}))
  // PDF fonts may encode fi/fl as ligatures; compare their Unicode equivalents.
  const extractedText=inspected.text.normalize('NFKC').replace(/\s+/g,' ')
  assert.equal(inspected.pages,artifact===report?1:2);assert.ok(extractedText.includes(artifact===report?'Portable export verification':'Second slide'))
  if(artifact===report){assert.ok(!inspected.text.includes('# Independent report'));assert.ok(!inspected.text.includes('来源:'))}
  files.push({file:file.fileName,pages:inspected.pages})
}
const ffmpeg=await getMediaFFmpegPath(),frame=join(out,'frame.png'),video=join(out,'preview.mp4')
await writeFile(frame,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'))
execFileSync(ffmpeg,['-y','-hide_banner','-loglevel','error','-loop','1','-i',frame,'-t','1','-vf','scale=160:90','-c:v','libx264','-pix_fmt','yuv420p',video],{windowsHide:true})
const poster=await videoPoster({path:video});assert.equal((await readFile(poster.path)).readUInt16BE(0),0xffd8);assert.deepEqual(await videoPoster({path:video}),poster)
const map=await exportDocument(mindmapFixture(),out,'png')
const png=JSON.parse(execFileSync(process.env.DSH_OFFICE_PYTHON,['-I','-c','import json,sys; from PIL import Image,ImageChops; im=Image.open(sys.argv[1]).convert("RGB"); box=ImageChops.difference(im,Image.new("RGB",im.size,"white")).getbbox(); assert box and box[0]>1 and box[1]>1 and box[2]<im.width-1 and box[3]<im.height-1; print(json.dumps({"width":im.width,"height":im.height,"contentBounds":box}))',map.path],{encoding:'utf8',windowsHide:true}))
const result={passed:true,files,poster:'JPEG',cachedPoster:true,serverMindmapPNG:png,externalModelCalls:false}
await writeFile(join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
