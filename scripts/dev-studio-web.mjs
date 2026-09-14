import { prepareProductPresets } from '../dsh-host/product-presets.mjs'
import { loadUserConfig } from '../dsh-host/user-config.mjs'
import { loadMediaProviders } from '../dsh-host/media-config.mjs'
// Launch only a prepared mainline Web assembly. Private host configuration and
// mutable test data stay outside the source and immutable package directory.
import {mkdir,readFile,writeFile,open,stat} from 'node:fs/promises'
import {resolve,join,dirname} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {spawn} from 'node:child_process'
import {registerHooks} from 'node:module'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'

const command=process.argv[2] || 'status',configPath=resolve(process.argv[3] || 'dist/studio-web.private.json')
const config=JSON.parse(await readFile(configPath,'utf8'))
const assembly=resolve(config.assembly),runtime=join(assembly,'d'),home=resolve(config.home)
const records=resolve(config.logs),controlPath=join(records,'control.json'),logPath=join(records,'web.log')
const profileName=config.profileName || 'chatecnu-work-web'
if(!/^[a-z0-9-]+$/.test(profileName))throw new Error('Invalid Web profile name')
const profile=join(home,'profiles',profileName),port=config.port || 8788
const identity=JSON.parse(await readFile(join(assembly,'assembly.json'),'utf8'))
const json=async p=>JSON.parse(await readFile(p,'utf8'))
const save=async(p,value)=>{await mkdir(dirname(p),{recursive:true});await writeFile(p,JSON.stringify(value,null,2)+'\n')}
const live=pid=>{try{process.kill(pid,0);return true}catch{return false}}
async function setup() {
  await mkdir(profile,{recursive:true})
  const productWeb=identity.kind==='eduwork-web'
  const bundles=productWeb?identity.bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@chatecnu-work/dsh-bundle-studio-web',...(identity.ecnu?['@chatecnu-work/dsh-bundle-oidc-ecnu-web']:[]),...(identity.allPlugins?['@eduwork/dsh-mail','@eduwork/dsh-memory',...(!identity.ecnu?['@eduwork/dsh-oidc']:[])]:[])]
  await save(join(profile,'package.json'),{name:productWeb?'eduwork-local-web':'chatecnu-work-web-integration',private:true,type:'module',dsh:{profile:{bundles}}})
  // These are the same Host service names and Skill setting policy selected by
  // the desktop composition. Native desktop services stay out of this Web host.
  const sharedManifest=await json(join(runtime,'node_modules/@eduwork/dsh-artifact-services/package.json'))
  const genericImages=Boolean(sharedManifest.exports?.['./images'])
  if(productWeb) {
    const user = config.userConfig ? loadUserConfig(resolve(config.userConfig)) : undefined
    const media = await loadMediaProviders(assembly, user)
    const composition=await json(join(assembly,'composition.json'))
    for(const row of composition) {
      for(const plugin of row.insert || []) {
        if(config.pluginConfig?.[plugin.id])plugin.config={...plugin.config,...config.pluginConfig[plugin.id]}
        if(plugin.id==='eduwork-media-openai')plugin.config=media
        if(plugin.id==='eduwork-artifact-services')plugin.config={...plugin.config,images:{enabled:media.providers.some(provider=>provider.images?.enabled)}}
        if(user && plugin.id==='enterprise-oidc')plugin.config={...plugin.config,profiles:user.organizations,allowEmptyProfiles:true,configFile:user.source,profilePathEnv:'EDUWORK_NO_IMPLICIT_ENTERPRISE_PROFILE'}
      }
      if(row.id==='session-query-sqlite')row.config.path=join(home,'session-query-memory.sqlite3')
    }
    await save(join(profile,'cordis.patch.yml'),[...composition,...(config.patches || [])])
  } else {
  const insert=[{id:'dsh-artifact-services',name:'@eduwork/dsh-artifact-services/dsh',config:{skills:false}},
    {id:'dsh-knowledge-studio',name:'@eduwork/dsh-knowledge-studio',config:{skills:!identity.skills?.includes('knowledge-studio')}},
    {id:'chatecnu-work-skill-settings',name:'@chatecnu-work/dsh-skill-settings-native'}]
  if(identity.ecnu)insert.push({id:'tool-ecnu-media',name:'@chatecnu-work/dsh-tool-ecnu-media',config:{...config.ecnuMedia,legacyTools:!genericImages}},
    {id:'chatecnu-work-shared-speech-ecnu',name:'@chatecnu-work/dsh-studio-media-ecnu',config:{...config.ecnuMedia,...config.ecnuSpeech}})
  await save(join(profile,'cordis.patch.yml'),[{insert}])
  }
  if(process.platform==='win32') {
    const linker=fileURLToPath(new URL('./link-studio-web-profile.ps1',import.meta.url))
    await new Promise((done,fail)=>{
      const child=spawn('pwsh',['-NoProfile','-File',linker,'-Config',configPath],{windowsHide:true,stdio:'inherit'})
      child.on('error',fail);child.on('exit',code=>code===0?done():fail(new Error('Profile module linking failed')))
    })
    for(const name of ['@deepseek-ai/dsh-persona','@chatecnu-work/dsh-skill-control-native','@eduwork/dsh-artifact-services','@eduwork/dsh-knowledge-studio']) {
      if(!await stat(join(profile,'node_modules',name,'package.json')).then(x=>x.isFile()).catch(()=>false))throw new Error('Profile cannot follow the assembled package links. Use a native local assembly path outside redirected AppData.')
    }
  }
}
async function stop() {
  const old=await json(controlPath).catch(()=>null)
  if(!old||!live(old.pid))return
  const response=await fetch(`http://127.0.0.1:${old.port}/stop`,{method:'POST',headers:{Authorization:`Bearer ${old.secret}`}})
  if(!response.ok)throw new Error('Web control refused shutdown')
  for(let i=0;i<120&&live(old.pid);i++)await new Promise(r=>setTimeout(r,250))
  if(live(old.pid))throw new Error('Web host is still exiting; inspect its log')
}
if(command==='worker') {
  for(const [key,value] of Object.entries(config.environment || {}))if(typeof value==='string')process.env[key]=value
  process.env.DSH_HOME=home;process.env.DSH_TELEMETRY_DISABLED='1'
  process.env.DSH_BUNDLED_SKILL_DIR=join(assembly,'skills')
  process.env.CHATECNU_WEB_PRESETS=join(runtime,'presets')
  if(identity.kind==='eduwork-web') {
    Object.assign(process.env, await prepareProductPresets({product:assembly,home}))
    process.env.EDUWORK_PRODUCT_ROOT=assembly
    process.env.DSH_MEDIA_NODE_ENV ||= runtime
  }
  if(config.enterpriseProfile) {
    process.env.DSH_OIDC_ENTERPRISE_PROFILE=config.enterpriseProfile
    process.env.EDUWORK_OIDC_PROFILE=config.enterpriseProfile
  }
  const parentURL=pathToFileURL(join(runtime,'package.json')).href
  registerHooks({resolve(specifier,context,next){
    const managed=specifier.startsWith('@deepseek-ai/') || specifier.startsWith('@chatecnu-work/') || specifier.startsWith('@eduwork/')
    return next(specifier,managed?{...context,parentURL}:context)
  }})
  const secret=randomUUID(),server=createServer((req,res)=>{
    if(req.method!=='POST'||req.url!=='/stop'||req.headers.authorization!==`Bearer ${secret}`){res.writeHead(403).end();return}
    res.end('Stopping');server.close();setImmediate(()=>process.emit('SIGTERM'))
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r));server.unref()
  await save(controlPath,{pid:process.pid,port:server.address().port,secret,startedAt:new Date().toISOString(),assembly,version:identity.version})
  // Cold starts may outlive the foreground launcher's 30-second observation.
  // The worker owns readiness so background completion still gets recorded.
  let checkingReady=false
  const readyTimer=setInterval(async()=>{
    if(checkingReady)return
    checkingReady=true
    try {
      const text=await readFile(logPath,'utf8')
      const url=text.match(new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=[^\\s]+`))?.[0]
      if(url){await writeFile(join(records,'url.txt'),url);clearInterval(readyTimer)}
    } catch {} finally {checkingReady=false}
  },250)
  readyTimer.unref()
  process.argv=[process.execPath,join(runtime,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile',profileName,'--host','127.0.0.1','--port',String(port),'--no-open']
  const cli=await import(pathToFileURL(process.argv[1]))
  // Alpha.2 guards its executable with import.meta.main. Older releases start
  // on import; call only the new explicit entry point to support both.
  if(typeof cli.runCli==='function')await cli.runCli()
} else if(command==='stop') {await stop();console.log('Web integration stopped.')}
else if(command==='status') {
  const old=await json(controlPath).catch(()=>null)
  console.log(JSON.stringify({running:!!old&&live(old.pid),pid:old?.pid,version:identity.version,url:`http://127.0.0.1:${port}`,logs:records},null,2))
} else if(command==='start'||command==='restart') {
  if(command==='restart')await stop()
  const old=await json(controlPath).catch(()=>null)
  if(old&&live(old.pid))throw new Error('Web integration is already running')
  await setup();await mkdir(records,{recursive:true})
  await writeFile(join(records,'url.txt'),'')
  const fd=await open(logPath,'w'),child=spawn(config.node || process.execPath,[fileURLToPath(import.meta.url),'worker',configPath],{cwd:assembly,detached:true,windowsHide:true,stdio:['ignore',fd.fd,fd.fd]})
  child.unref();await fd.close()
  for(let i=0;i<120;i++) {
    await new Promise(r=>setTimeout(r,250))
    const text=await readFile(logPath,'utf8'),url=text.match(new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=[^\\s]+`))?.[0]
    if(url){await writeFile(join(records,'url.txt'),url);console.log(`Ready: http://127.0.0.1:${port} (PID ${child.pid}); authenticated URL saved locally.`);process.exit(0)}
    if(!live(child.pid))throw new Error('Web host exited; inspect the local log')
  }
  console.log(`Starting in background (PID ${child.pid}); inspect ${records}.`)
} else throw new Error('Use start, restart, stop, or status')
