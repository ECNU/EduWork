import { readdir, readFile, lstat } from 'node:fs/promises'
import { resolve, join, dirname, relative, basename } from 'node:path'

const root = resolve(process.argv[2] || '.')
const files = [], broken = [], readmeIssues = []
// Preserve the README shipped with this unmodified third-party dependency.
const upstreamReadmes = new Set(['dsh-host/vendor/jsonc-parser/README.md'])
let readmePairs = 0
async function walk(directory) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    if(['.git','node_modules','dist','.local'].includes(entry.name) || entry.isSymbolicLink())continue
    const path=join(directory,entry.name)
    if(entry.isDirectory())await walk(path)
    else if(entry.name.endsWith('.md'))files.push(path)
  }
}
await walk(root)
let links=0
for(const file of files) {
  const text=(await readFile(file,'utf8')).replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm,'')
  const pathInRepo=relative(root,file).replaceAll('\\','/')
  const name=basename(file)
  if(/^README(?:[._-].*)?\.md$/i.test(name) && !upstreamReadmes.has(pathInRepo)) {
    if(!['README.md','README_EN.md'].includes(name)) {
      readmeIssues.push({file:pathInRepo,reason:'Use README.md and README_EN.md'})
    } else {
      const counterpart=name==='README.md'?'README_EN.md':'README.md'
      if(!await lstat(join(dirname(file),counterpart)).catch(()=>null)) {
        readmeIssues.push({file:pathInRepo,reason:`Missing ${counterpart}`})
      } else if(name==='README.md')readmePairs++
      if(!text.includes(`](${counterpart})`)) {
        readmeIssues.push({file:pathInRepo,reason:`Missing language link to ${counterpart}`})
      }
      const prose=text.replace(/^#+[^\n]*$/gm,'').replace(/^.*\]\(README(?:_EN)?\.md\).*$/gm,'')
      if(name==='README.md' && !/\p{Script=Han}/u.test(prose)) {
        readmeIssues.push({file:pathInRepo,reason:'Default README needs Chinese prose'})
      }
    }
  }
  for(const match of text.matchAll(/\[[^\]\n]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
    const raw=match[1]??match[2]
    if(/^(?:[a-z]+:|#|\/\/)/i.test(raw))continue
    const target=decodeURIComponent(raw.split('#')[0])
    if(!target)continue
    links++
    const path=resolve(dirname(file),target)
    if(!await lstat(path).catch(()=>null))broken.push({file:relative(root,file).replaceAll('\\','/'),target})
  }
}
console.log(JSON.stringify({files:files.length,links,readmePairs,broken,readmeIssues},null,2))
if(broken.length || readmeIssues.length)process.exitCode=1
