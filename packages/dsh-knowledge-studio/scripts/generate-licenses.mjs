import {readFile, readdir, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {dirname, join} from 'node:path'
const require=createRequire(import.meta.url), seen=new Set(), records=[]
async function visit(name, parent=require) {
  let manifest
  try {manifest=parent.resolve(name+'/package.json')} catch {
    let path=dirname(parent.resolve(name))
    while(true) {
      try {const candidate=join(path,'package.json');if(JSON.parse(await readFile(candidate,'utf8')).name===name){manifest=candidate;break}}catch{}
      const next=dirname(path);if(next===path)throw new Error('No manifest for '+name);path=next
    }
  }
  const pkg=JSON.parse(await readFile(manifest,'utf8')),key=pkg.name+'@'+pkg.version
  if(seen.has(key))return;seen.add(key)
  const root=dirname(manifest),files=(await readdir(root)).filter(x=>/^(license|licence|copying|notice)(\.|$)/i.test(x)).sort()
  if(!files.length)throw new Error('Missing bundled dependency license: '+key)
  for(const file of files)records.push([key+' / '+file,(await readFile(join(root,file),'utf8')).replaceAll('\r\n','\n')])
  for(const dependency of Object.keys(pkg.dependencies||{}).sort())await visit(dependency,createRequire(manifest))
}
for(const name of ['react','react-dom','react-markdown','remark-gfm','remark-parse','unified','zod','unpdf'])await visit(name)
// PDF.js is built into unpdf. Its Apache license is the standard complete text;
// retain Mozilla's copyright and identify the adapted redistribution separately.
const apache=(await readFile(require.resolve('playwright-core/package.json').replace(/package\.json$/,'LICENSE'),'utf8')).replaceAll('\r\n','\n')
records.push(['PDF.js (bundled by unpdf) / Apache-2.0','Copyright Mozilla Foundation.\nPDF.js is redistributed with environment/loading adaptations through unpdf.\n\n'+apache])
records.sort((a,b)=>a[0].localeCompare(b[0],'en'))
await writeFile('THIRD_PARTY_LICENSES.txt','Licenses for bundled JavaScript dependencies. Generated from the locked install.\n\n'+records.map(([name,text])=>'==== '+name+' ====\n\n'+text.trim()+'\n').join('\n'))
console.log(`Collected ${records.length} license/notice texts for ${seen.size} packages and PDF.js.`)
