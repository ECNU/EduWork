// Explicit source-built alpha channel. This does not promote npm release locks.
import assert from 'node:assert/strict'
import { cp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { parse } from '../dsh-host/vendor/jsonc-parser/parser.js'
import { parseUserConfig } from '../dsh-host/user-config.mjs'
import { documentConfiguration } from '../dsh-host/configuration-documentation.mjs'
import { readPublisherBootstrap } from '../dsh-host/publisher-bootstrap.mjs'

const { values } = parseArgs({ options: Object.fromEntries(['product','edition','version','publisher-descriptors','channel'].map(key=>[key,{type:'string'}])) })
for(const key of ['product','version']) if(!values[key]) throw Error('Missing --'+key)
const stable=values.channel==='stable'
if(values.channel && !['stable','development'].includes(values.channel)) throw Error('Unknown source build channel')
if(!(stable?/^0\.4\.0$/:/^\d+\.\d+\.\d+-dev\.\d{8}\.[1-9]\d*$/).test(values.version)) throw Error('Version does not match the explicit source build channel')
const product=resolve(values.product)
const read=async file=>JSON.parse(await readFile(file,'utf8'))
const save=async(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n')
const identity=await read(join(product,'assembly.json'))
assert.equal(identity.pluginMode,'source-qualification')
assert.equal(identity.dshVersion,'0.2.0-rc.1')
assert.notEqual(identity.sourceAlpha,true,'Prepare each source Alpha only once')
const resources=join(product,'resources/desktop')
const generic=await read(new URL('../config/distributions/generic.json',import.meta.url))
generic.packages=generic.packages.map(name=>name==='@shlv/dsh-literature'?'@eduwork/dsh-literature':name)
const pluginNames=generic.plugins.map(plugin=>plugin.name)
if(values.edition){
  const edition=resolve(values.edition), distribution=await read(join(edition,'edition/distribution.json'))
  const require=createRequire(join(product,'d/package.json')), {build}=require('esbuild')
  const runtime=await read(join(product,'d/package.json')), composition=await read(join(product,'composition.json'))
  const entries=[]
  for(const plugin of distribution.plugins){
    const destination=join(product,'d/node_modules',plugin.name)
    await cp(join(edition,plugin.source),destination,{recursive:true})
    const manifest=await read(join(destination,'package.json'))
    for(const name of Object.keys(manifest.peerDependencies??{})) if(name.startsWith('@deepseek-ai/dsh')) manifest.peerDependencies[name]=identity.dshVersion
    manifest.private=true
    await save(join(destination,'package.json'),manifest)
    runtime.dependencies[plugin.name]=manifest.version
    entries.push({id:plugin.id,name:plugin.name,config:plugin.config??{}})
    if(manifest.dsh?.client && await access(join(destination,'src/client.ts')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error})) await build({absWorkingDir:destination,entryPoints:['src/client.ts'],outfile:'lib/client.js',bundle:true,platform:'browser',format:'cjs',target:'es2022',minify:true,
      nodePaths:[join(product,'d/node_modules')],external:['react','react/*','@deepseek-ai/cordis','@deepseek-ai/dsh-client-ui-slots','@deepseek-ai/dsh-client-store'],
      banner:{js:`window.__ModuleLoader__.load({id:${JSON.stringify(plugin.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`},footer:{js:'return module.exports;}});'}})
  }
  composition.push({insert:entries},{id:'eduwork-brand-settings',config:distribution.brand})
  Object.assign(identity,{distribution:distribution.id,brand:distribution.brand,capabilities:distribution.capabilities,
    editionCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:edition,encoding:'utf8',windowsHide:true}).trim(),sourcePackages:[...identity.sourcePackages,...entries.map(entry=>entry.name)]})
  for(const skill of distribution.skills) await cp(join(edition,skill.source),join(product,'skills',skill.name),{recursive:true})
  for(const resource of distribution.resources){
    assert.equal(resource.root,'edition')
    await mkdir(resolve(product,'resources',resource.target,'..'),{recursive:true})
    await cp(join(edition,resource.source),join(product,'resources',resource.target),{recursive:true})
  }
  pluginNames.push(...entries.map(entry=>entry.name))
  await save(join(product,'d/package.json'),runtime)
  await save(join(product,'composition.json'),composition)
}
const configuration=parse(await readFile(join(resources,'eduwork.jsonc'),'utf8'))
// Generic products have user-owned configuration and no publisher descriptor.
const policy=await read(join(resources,'configuration-policy.json')).catch(error=>{
  if(error.code!=='ENOENT') throw error
  return {schemaVersion:1,ownership:'user'}
})
assert.equal(policy.schemaVersion,1)
assert.ok(['user','publisher'].includes(policy.ownership),'Unknown configuration ownership')
if(policy.ownership==='publisher'){
  if(!values['publisher-descriptors']) throw Error('Publisher Alpha needs explicit compatible configuration descriptors')
  for(const name of ['publisher-bootstrap.json','publisher-bootstrap.darwin.json'])
    await cp(join(resolve(values['publisher-descriptors']),name),join(resources,name))
}
function noCredentials(value){if(!value||typeof value!=='object')return;for(const[key,item]of Object.entries(value)){
  if(/^(?:apiKey|accessToken|refreshToken|idToken|clientSecret|password|secret|token)$/i.test(key)) throw Error('Credential field in alpha template: '+key)
  noCredentials(item)
}}
noCredentials(configuration)
configuration.updates=stable?{...configuration.updates,defaultPolicy:'stable',...(policy.ownership==='user'?{provider:'github',repository:'ECNU/EduWork'}:{})}:{provider:'disabled'}
const body=documentConfiguration(JSON.stringify(configuration,null,2)+'\n')
parseUserConfig(join(resources,'eduwork.jsonc'),body)
await writeFile(join(resources,'eduwork.jsonc'),body)
// Preserve signed publisher configuration and its compatibility checks. Software
// update channels stay disabled until this explicit Alpha has been accepted.
for(const name of ['publisher-bootstrap.json','publisher-bootstrap.darwin.json']){
  const path=join(resources,name)
  const descriptor=await read(path).catch(error=>{if(error.code!=='ENOENT')throw error})
  if(descriptor){descriptor.updates=stable?{...descriptor.updates}:{provider:'disabled'};await save(path,descriptor)}
}
for(const platform of ['win32','darwin']) await readPublisherBootstrap({ownership:policy.ownership,product,platform})
if(!stable) await rm(join(resources,'mac-updates.json'),{force:true})
identity.localPlugins={};identity.managedPackages={}
for(const name of pluginNames) identity.localPlugins[name]={version:(await read(join(product,'d/node_modules',name,'package.json'))).version,source:true}
for(const name of generic.packages) identity.managedPackages[name]={version:(await read(join(product,'d/node_modules',name,'package.json'))).version,source:identity.sourcePackages.includes(name)}
Object.assign(identity,{version:values.version,qualification:'Pinned DSH 0.2.0 source build; package and component receipts retained',automaticUpdates:stable,
  sourceAlpha:!stable,sourceRelease:stable,releaseChannel:stable?'stable':'development',published:false})
await save(join(product,'assembly.json'),identity)
console.log(JSON.stringify({distribution:identity.distribution,version:identity.version,dshVersion:identity.dshVersion,sourceAlpha:!stable,automaticUpdates:stable}))
