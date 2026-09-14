import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {gunzipSync} from 'node:zlib'
import {npm} from './npm.mjs'
import {assertPublicText} from './public-policy.mjs'
import {auditPackageDocuments} from './document-policy.mjs'
const root=resolve('.'),output=resolve('dist/packages'),packages=[]
await mkdir(output,{recursive:true})
let sourceCommit=null
try {sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()}catch{}
if(process.argv.includes('--require-clean')) {
  if(!sourceCommit||execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw new Error('Release tarballs require a clean committed checkout')
}
for(const directory of ['packages/artifact-services','.']) {
  const [packed]=JSON.parse(npm(['pack','--ignore-scripts','--json','--pack-destination',output],{cwd:resolve(directory)}))
  const bytes=await readFile(join(output,packed.filename))
  // Inspect the actual archive, including generated bundles omitted from Git.
  const archive=gunzipSync(bytes,{maxOutputLength:256*1024*1024})
  assertPublicText(archive.toString('utf8'),packed.filename)
  auditPackageDocuments(archive,packed.filename)
  const payload=packed.files.map(f=>f.path).sort()
  if(payload.some(p=>/(^|\/)(node_modules|__pycache__|\.dev-local|dist)(\/|$)|\.pyc$/.test(p)))throw new Error('Unexpected release payload')
  if(packed.name==='@eduwork/dsh-knowledge-studio') {
    if(payload.some(p=>/(^|\/)(?:experimental|wiki(?:[-.][^/]*)?)(?:\/|$)/i.test(p)))throw new Error('Wiki code must not ship in the current Studio package')
    const text=archive.toString('utf8')
    for(const marker of ['knowledge_studio_generate_wiki','class WikiGenerator','new WikiGenerator(', 'function WikiReader(', 'data-wiki-progress']) {
      if(text.includes(marker))throw new Error('Wiki runtime entry leaked into the Studio package: '+marker)
    }
  }
  const manifest=JSON.parse(await readFile(resolve(directory,'package.json'),'utf8'))
  for(const entry of Object.values(manifest.exports))if(!payload.includes(entry.replace(/^\.\//,'')))throw new Error('Missing export '+entry)
  packages.push({name:packed.name,version:packed.version,filename:packed.filename,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64'),sourceCommit,files:payload})
}
await writeFile(join(output,'packages.json'),JSON.stringify(packages,null,2)+'\n')
console.log(JSON.stringify(packages.map(({files,...p})=>p),null,2))
