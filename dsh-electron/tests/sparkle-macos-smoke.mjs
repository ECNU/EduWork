// Native acceptance uses temporary keys, a local HTTPS feed and disposable apps.
// The CLI exercises real Sparkle installation; it does not replace the native UI.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:https'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'

assert.equal(process.platform, 'darwin', 'Native Sparkle checks require macOS')
const root=resolve(process.argv[2]), repository=fileURLToPath(new URL('..',import.meta.url))
const evidence=join(root,'evidence'), frameworkRoot=join(root,'sparkle')
await mkdir(evidence,{recursive:true});await mkdir(frameworkRoot,{recursive:true})
let sequence=0,server
const run=async(command,args,{failure=false,env={}}={})=>{
  const child=spawn(command,args,{env:{...process.env,...env},stdio:['ignore','pipe','pipe']})
  let output='';child.stdout.on('data',b=>{output+=b});child.stderr.on('data',b=>{output+=b})
  const code=await new Promise((accept,reject)=>{child.on('error',reject);child.on('close',accept)})
  await writeFile(join(evidence,`${++sequence}-${command.split('/').at(-1)}.log`),output)
  if(!failure)assert.equal(code,0,`${command}: ${output}`)
  return {code,output}
}
const result={passed:false,checks:[],nativeUIAutomation:false}
try {
  const lock=JSON.parse(await readFile(join(repository,'sparkle.lock.json'),'utf8'))
  const response=await fetch(lock.url);assert.ok(response.ok)
  const bytes=Buffer.from(await response.arrayBuffer())
  assert.equal(createHash('sha256').update(bytes).digest('hex'),lock.sha256)
  await writeFile(join(root,'sparkle.tar.xz'),bytes)
  await run('tar',['-xf',join(root,'sparkle.tar.xz'),'-C',frameworkRoot])
  const framework=join(frameworkRoot,'Sparkle.framework')
  const electron=join(root,'tools/node_modules/electron/dist/Electron.app')
  const headers=join(root,'headers');await mkdir(headers)
  const nodeHeaders=await fetch(`https://nodejs.org/dist/${process.version}/node-${process.version}-headers.tar.gz`)
  assert.ok(nodeHeaders.ok);await writeFile(join(root,'headers.tar.gz'),Buffer.from(await nodeHeaders.arrayBuffer()))
  await run('tar',['-xf',join(root,'headers.tar.gz'),'-C',headers,'--strip-components=1'])
  const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64')
  const cert=join(root,'localhost.crt'),key=join(root,'localhost.key')
  await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE','-addext','extendedKeyUsage=serverAuth','-addext','keyUsage=digitalSignature,keyEncipherment,keyCertSign'])
  await run('sudo',['security','add-trusted-cert','-d','-r','trustRoot','-k','/Library/Keychains/System.keychain',cert])
  await run('security',['verify-cert','-c',cert,'-p','ssl','-s','localhost']);
  let archive,signature,offerVersion='2'
  const requests=[];
  server=createServer({key:await readFile(key),cert:await readFile(cert)},(request,response)=>{
    requests.push({url:request.url,method:request.method});
    if(request.url==='/update.zip'){response.end(archive);return}
    response.setHeader('content-type','application/xml')
    response.end(`<?xml version="1.0"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Test updates</title><item><title>Test ${offerVersion}</title><sparkle:version>${offerVersion}</sparkle:version><sparkle:shortVersionString>0.3.${offerVersion}</sparkle:shortVersionString><enclosure url="https://localhost:${server.address().port}/update.zip" length="${archive.length}" type="application/octet-stream" sparkle:edSignature="${signature}" /></item></channel></rss>`)
  })
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok))
  const feed=`https://localhost:${server.address().port}/appcast.xml`,appName='EduWork Sparkle Test.app'
  const bundleID=`org.eduwork.sparkle-test.t${Date.now()}`
  const prepare=async(version)=>{
    const folder=join(root,`version-${version}`),app=join(folder,appName)
    await mkdir(folder);await run('ditto',[electron,app])
    await run('ditto',[framework,join(app,'Contents/Frameworks/Sparkle.framework')])
    const payload=join(app,'Contents/Resources/app');await mkdir(join(payload,'native'),{recursive:true})
    await run('clang++',['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-I',join(headers,'include/node'),'-F',join(app,'Contents/Frameworks'),'-framework','Sparkle','-framework','AppKit','-Wl,-rpath,@loader_path/../../../Frameworks',join(repository,'native/sparkle-addon.mm'),'-o',join(payload,'native/sparkle.node')])
    await writeFile(join(payload,'package.json'),JSON.stringify({name:'eduwork-sparkle-test',version:'1.0.0',main:'main.cjs'}))
    await writeFile(join(payload,'main.cjs'),`const {app}=require('electron');const fs=require('node:fs');app.whenReady().then(()=>{const addon=require('./native/sparkle.node');addon.start(${JSON.stringify(feed)});addon.probe();const started=Date.now();const timer=setInterval(()=>{const state=addon.snapshot();if(state.state==='checking'&&Date.now()-started<30000)return;clearInterval(timer);fs.writeFileSync(process.env.EDUWORK_SPARKLE_RESULT,JSON.stringify({version:${JSON.stringify(version)},...state}));app.exit(state.state==='error'?1:0)},100)})`)
    const plist=join(app,'Contents/Info.plist')
    for(const [name,value] of Object.entries({CFBundleIdentifier:bundleID,CFBundleVersion:version,CFBundleShortVersionString:`0.3.${version}`,SUPublicEDKey:publicKey,SUFeedURL:feed})) await run('plutil',['-replace',name,'-string',value,plist])
    await run('plutil',['-replace','SUEnableAutomaticChecks','-bool','NO',plist])
    await run('xattr',['-cr',app]);await run('codesign',['--force','--deep','--sign','-','--timestamp=none',app])
    await run('codesign',['--verify','--deep','--strict',app])
    return app
  }
  const oldApp=await prepare('1'),newApp=await prepare('2')
  const zip=join(root,'update.zip');await run('ditto',['-c','-k','--sequesterRsrc','--keepParent',newApp,zip])
  archive=await readFile(zip);signature=sign(null,archive,pair.privateKey).toString('base64')
  const marker=join(evidence,'probe.json')
  const probeRun=await run(join(oldApp,'Contents/MacOS/Electron'),[],{failure:true,env:{EDUWORK_SPARKLE_RESULT:marker}});
  await writeFile(join(evidence,'requests.json'),JSON.stringify(requests,null,2));
  assert.equal(probeRun.code,0,await readFile(marker,'utf8'))
  assert.equal(JSON.parse(await readFile(marker)).state,'available');result.checks.push('Electron loads the actual N-API bridge and probes the HTTPS feed')
  const paths=await readdir(join(frameworkRoot,'bin'),{recursive:true})
  const cliRelative=paths.find(path=>path.endsWith('/Contents/MacOS/Updater')) ?? paths.find(path=>path==='sparkle-cli')
  assert.ok(cliRelative,`Sparkle CLI not found: ${paths.join(',')}`)
  const cli=join(frameworkRoot,'bin',cliRelative)
  const args=[oldApp,'--check-immediately','--feed-url',feed,'--user-agent-name','EduWork native CI','--verbose']
  const originalSignature=signature;signature=Buffer.alloc(64).toString('base64')
  assert.notEqual((await run(cli,args,{failure:true})).code,0)
  assert.equal((await run('plutil',['-extract','CFBundleVersion','raw',join(oldApp,'Contents/Info.plist')])).output.trim(),'1')
  result.checks.push('Invalid EdDSA signature cannot replace the old app')
  signature=originalSignature
  await run(cli,args)
  assert.equal((await run('plutil',['-extract','CFBundleVersion','raw',join(oldApp,'Contents/Info.plist')])).output.trim(),'2')
  await run('codesign',['--verify','--deep','--strict',oldApp])
  await run(join(oldApp,'Contents/MacOS/Electron'),[],{env:{EDUWORK_SPARKLE_RESULT:marker}})
  const after=JSON.parse(await readFile(marker));assert.equal(after.version,'2');assert.equal(after.state,'up_to_date')
  result.checks.push('Signed ZIP installs in place; updated Electron launches and reports latest version')
  result.passed=true
} catch(error) {result.error=error.stack;throw error}
finally {server?.close();await writeFile(join(evidence,'result.json'),JSON.stringify(result,null,2)+'\n')}
