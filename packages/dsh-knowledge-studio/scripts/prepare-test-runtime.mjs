import {chromium} from '@playwright/test'
import {createMediaRuntime} from '@eduwork/dsh-artifact-services/runtime'
import {access,mkdir,writeFile,appendFile} from 'node:fs/promises'
import {resolve} from 'node:path'
const candidate=process.env.STUDIO_TEST_BROWSER||chromium.executablePath()
let runtime
if(await access(candidate).then(()=>true,()=>false))runtime=await createMediaRuntime({environment:{DSH_MEDIA_NODE_ENV:resolve('.'),DSH_MEDIA_BROWSER:resolve(candidate)}})
else runtime=await createMediaRuntime({environment:{}})
const environment={DSH_MEDIA_NODE_ENV:runtime.nodeEnv,DSH_MEDIA_BROWSER:runtime.browserExecutable,STUDIO_TEST_BROWSER:runtime.browserExecutable}
await mkdir('.dev-local',{recursive:true});await writeFile('.dev-local/test-runtime.json',JSON.stringify(environment,null,2))
if(process.env.GITHUB_ENV)await appendFile(process.env.GITHUB_ENV,Object.entries(environment).map(([key,value])=>key+'='+value).join('\n')+'\n')
console.log('Test browser and media runtime prepared. Local paths are stored in ignored .dev-local/test-runtime.json.')
