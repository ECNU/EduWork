import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {desktopConfigurationPath} from '../src/configuration-policy.mjs'
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
