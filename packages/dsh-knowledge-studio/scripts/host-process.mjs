import {mkdtemp,mkdir,writeFile,appendFile,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {fork} from 'node:child_process'
import {createServer} from 'node:net'
import {seedHostSession} from './host-session-fixture.mjs'
import {seedHostMindmap} from './host-mindmap-fixture.mjs'
import {seedGlobalPanel} from './host-global-panel-fixture.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
export async function startIsolatedHost({syntheticSession=false,syntheticMindmap=false,syntheticOffice=false,globalPanelFixture=false,reuseHome}={}) {
  const runtime=resolve(process.env.STUDIO_TEST_DSH_RUNTIME||root)
  const home=reuseHome?resolve(reuseHome):await mkdtemp(join(tmpdir(),'knowledge-studio-host-')),profile=join(home,'profiles','studio')
  const fixture=syntheticSession||syntheticMindmap||syntheticOffice?await seedHostSession(runtime,home):undefined
  if(syntheticMindmap||syntheticOffice)Object.assign(fixture,await seedHostMindmap(runtime,home,fixture,{office:syntheticOffice}))
  await mkdir(join(profile,'node_modules'),{recursive:true})
  for(const [name,target] of [['@deepseek-ai',join(runtime,'node_modules','@deepseek-ai')],['@eduwork/dsh-knowledge-studio',root],['@eduwork/dsh-artifact-services',join(root,'packages','artifact-services')]]) {
    const path=join(profile,'node_modules',name);await mkdir(dirname(path),{recursive:true});if(!reuseHome)await symlink(target,path,process.platform==='win32'?'junction':'dir')
  }
  const extraBundles=globalPanelFixture?[await seedGlobalPanel(profile)]:[]
  await writeFile(join(profile,'package.json'),JSON.stringify({name:'isolated-studio-host',private:true,type:'module',dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@eduwork/dsh-knowledge-studio',...extraBundles]}}}))
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
  const child=fork(fileURLToPath(new URL('./host-worker.mjs',import.meta.url)),[home,String(port)],{cwd:root,env:{...process.env,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true})
  await writeFile(join(home,'process.json'),JSON.stringify({pid:child.pid,startedAt:new Date().toISOString(),port}))
  const exited=new Promise(resolve=>child.once('exit',resolve))
  const stop=async()=>{if(child.connected)child.send('stop');await exited}
  let output=''
  const ready=new Promise((resolve,reject)=>{
    child.once('error',reject);child.once('exit',code=>reject(new Error('Isolated DSH host exited before readiness: '+code)))
    for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{
      const text=bytes.toString();void appendFile(join(home,'host.log'),text);output+=text
      const launch=output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/)?.[0]
      if(launch)resolve(launch)
    })
  })
  try {return {home,port,child,stop,fixture,launch:await ready}}catch(error){await stop();throw error}
}
