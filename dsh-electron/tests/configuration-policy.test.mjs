import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {desktopConfigurationPath,publisherConfigurationOverride} from '../src/configuration-policy.mjs'
import {loadUserConfig} from '../../dsh-host/user-config.mjs'

test('publisher config changes with the executable version even when an old updater preserves config; rollback and personal data survive',async t=>{
 const root=await mkdtemp(join(tmpdir(),'eduwork-owned-config-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 await mkdir(join(root,'config'));await mkdir(join(root,'data'))
 const legacy=join(root,'config/eduwork.jsonc'),personal=join(root,'data/personal-models.json')
 await writeFile(legacy,'{"schemaVersion":1,"product":{"name":"Old school"}}')
 await writeFile(personal,'synthetic personal models and preferences')
 const before=await readFile(legacy,'utf8')
 for(const [version,name] of [['0.3.6-dev.20260914.3','School A'],['0.3.6','School B']]) {
   const path=desktopConfigurationPath({root,version,ownership:'publisher'})
   await writeFile(path,JSON.stringify({schemaVersion:1,product:{name},organizations:[]}))
   assert.equal(loadUserConfig(path).product.name,name)
 }
 assert.equal(loadUserConfig(desktopConfigurationPath({root,version:'0.3.6-dev.20260914.3',ownership:'publisher'})).product.name,'School A')
 assert.equal(desktopConfigurationPath({root,version:'0.3.6'}),legacy)
 assert.equal(await readFile(legacy,'utf8'),before)
 assert.equal(await readFile(personal,'utf8'),'synthetic personal models and preferences')
 assert.throws(()=>desktopConfigurationPath({root,version:'../../unsafe',ownership:'publisher'}))
 assert.throws(()=>desktopConfigurationPath({root,version:'0.3.6',ownership:'unknown'}))
 assert.throws(()=>desktopConfigurationPath({root,version:'0.3.6',override:'relative.jsonc'}))
})

test('Sparkle publisher config stays in the same user data path across app versions',()=>{
 const appRoot='/Applications/EduWork-ECNU.app/Contents/Resources/app'
 const writableRoot='/Users/test/Library/Application Support/eduwork-chatecnu-electron'
 for(const version of ['0.3.6','0.3.7']) {
   const settings={configurationOwnership:'publisher',publisherConfigLocation:'user-data',productVersion:version}
   const override=publisherConfigurationOverride({settings,appRoot,writableRoot})
   assert.equal(override,join(writableRoot,'config/eduwork.jsonc'))
   assert.equal(desktopConfigurationPath({root:writableRoot,version,ownership:'publisher',override}),override)
 }
 assert.equal(publisherConfigurationOverride({settings:{configurationOwnership:'publisher',publisherConfig:'../product/resources/desktop/eduwork.jsonc'},appRoot,writableRoot}),resolve(appRoot,'../product/resources/desktop/eduwork.jsonc'))
 assert.equal(publisherConfigurationOverride({settings:{configurationOwnership:'user'},appRoot,writableRoot}),undefined)
 assert.throws(()=>publisherConfigurationOverride({settings:{configurationOwnership:'publisher',publisherConfigLocation:'unknown'},appRoot,writableRoot}),/Unknown publisher configuration location/)
})
