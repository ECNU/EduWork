import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {startIsolatedHost} from './host-process.mjs'
const host=await startIsolatedHost()
await writeFile(join(host.home,'url.txt'),host.launch)
console.log(`Independent development host: http://127.0.0.1:${host.port}/`)
console.log(`Isolated home: ${host.home}; authenticated URL is in url.txt. Configure a model in this test host to generate content.`)
let stopping=false
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(stopping)return;stopping=true;await host.stop()})
await new Promise(resolve=>host.child.once('exit',resolve))
