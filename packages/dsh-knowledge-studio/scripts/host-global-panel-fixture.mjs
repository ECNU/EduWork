import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

/** Test-only plugin: exercise native global main navigation in a disposable host. */
export async function seedGlobalPanel(profile){
 const directory=join(profile,'node_modules','studio-global-panel-fixture')
 await mkdir(directory,{recursive:true})
 await writeFile(join(directory,'package.json'),JSON.stringify({name:'studio-global-panel-fixture',version:'0.0.0',type:'module',main:'./index.js',exports:{'.':'./index.js','./client':'./client.js'},dsh:{bundle:{patch:'./patch.yml'},client:{inject:['@deepseek-ai/dsh-client-ui-layout'],platform:'web',immediately:true}}}))
 await writeFile(join(directory,'index.js'),'export const name="studio-global-panel-fixture"; export function apply(){}\n')
 await writeFile(join(directory,'patch.yml'),'- insert:\n    - id: studio-global-panel-fixture\n      name: studio-global-panel-fixture\n      config: {}\n')
 await writeFile(join(directory,'client.js'),`window.__ModuleLoader__.load({id:'studio-global-panel-fixture',factory:()=>{
const inject=['slots','layout'];
function apply(ctx){
 ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'studio-global-panel-fixture'},()=> '全局面板测试内容'));
 ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'studio-global-panel-fixture',label:'全局面板测试',order:99},()=> '□'));
}
return {inject,apply};}});
`)
 return 'studio-global-panel-fixture'
}
