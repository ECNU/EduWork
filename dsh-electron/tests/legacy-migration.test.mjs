import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readMigrationLaunch, importLegacyData, writeMigrationHealth } from '../src/legacy-migration.mjs'

async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'eduwork-migration-中文 空格-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const settings={productVersion:'0.3.0',distribution:'eduwork-chatecnu'}
 const sourceHome=join(root,'data/dsh'),targetHome=join(root,'data/eduwork-chatecnu-electron/dsh')
 const transaction=join(root,'data/state/updates/transactions/0.3.0')
 await mkdir(transaction,{recursive:true});await mkdir(join(sourceHome,'sessions'),{recursive:true})
 await mkdir(join(sourceHome,'profiles'),{recursive:true})
 await writeFile(join(sourceHome,'sessions/a.json'),'historical session')
 await writeFile(join(sourceHome,'settings.yaml'),'workspace: preserved')
 await writeFile(join(sourceHome,'profiles/old.json'),'must not activate old runtime')
 const file=join(transaction,'migration.json'),health=join(transaction,'health.ok')
 await writeFile(file,JSON.stringify({schemaVersion:1,kind:'legacy-wails-v1',...settings,version:settings.productVersion,sourceHome}))
 const argv=['--eduwork-migration',file,'--update-health-file',health]
 const launch=await readMigrationLaunch({root,settings,argv})
 return {root,settings,sourceHome,targetHome,launch,argv,file,health}
}
test('copies verified history/settings without activating old plugins or credentials; source remains',async t=>{
 const f=await fixture(t), progress=[]
 const receipt=await importLegacyData({...f,onProgress:p=>progress.push(p)})
 assert.equal(await readFile(join(f.targetHome,'sessions/a.json'),'utf8'),'historical session')
 assert.equal(await readFile(join(f.sourceHome,'sessions/a.json'),'utf8'),'historical session')
 assert.equal(await readFile(join(f.targetHome,'settings.yaml'),'utf8'),'workspace: preserved')
 assert.ok(!(await readdir(f.targetHome)).includes('profiles'))
 assert.deepEqual(receipt.notActivated,['profiles']);assert.equal(receipt.credentials,'sign-in-required')
 assert.ok(progress.length)
 assert.equal((await importLegacyData(f)).handoffID,receipt.handoffID)
 await writeMigrationHealth(f.launch,'importing','复制数据')
 assert.equal(JSON.parse(await readFile(f.health,'utf8')).state,'importing')
 await writeMigrationHealth(f.launch,'ready');assert.equal(await readFile(f.health,'utf8'),'ok\n')
})
test('existing Electron data is never merged or overwritten',async t=>{
 const f=await fixture(t);await mkdir(f.targetHome,{recursive:true});await writeFile(join(f.targetHome,'user.txt'),'keep')
 await assert.rejects(importLegacyData(f),/already exists/)
 assert.equal(await readFile(join(f.targetHome,'user.txt'),'utf8'),'keep')
})

test('same-shell update acknowledges only its own health path and retains existing Electron data',async t=>{
 const f=await fixture(t)
 await mkdir(f.targetHome,{recursive:true});await writeFile(join(f.targetHome,'keep.txt'),'current history')
 const launch=await readMigrationLaunch({...f,argv:['--update-health-file',f.health]})
 assert.equal(launch.kind,'electron-update-v1')
 assert.equal(await importLegacyData({...f,launch}),null)
 assert.equal(await readFile(join(f.targetHome,'keep.txt'),'utf8'),'current history')
 await writeMigrationHealth(launch,'ready');assert.equal(await readFile(f.health,'utf8'),'ok\n')
 await assert.rejects(readMigrationLaunch({...f,argv:['--update-health-file',join(f.root,'health.ok')]}))
 await assert.rejects(readMigrationLaunch({...f,settings:{...f.settings,productVersion:'9.0.0'},argv:['--update-health-file',f.health]}))
})

test('the bridge handoff imports latest Wails sessions, not the old legacy snapshot',async t=>{
 const f=await fixture(t),sourceHome=join(f.root,'data',f.settings.distribution+'-wails','dsh')
 await mkdir(join(sourceHome,'sessions'),{recursive:true})
 await writeFile(join(sourceHome,'sessions/new.json'),'new work created after the first upgrade')
 await writeFile(f.file,JSON.stringify({schemaVersion:1,kind:'wails-host-v1',version:f.settings.productVersion,distribution:f.settings.distribution,sourceHome}))
 const launch=await readMigrationLaunch(f)
 await importLegacyData({...f,launch})
 assert.equal(await readFile(join(f.targetHome,'sessions/new.json'),'utf8'),'new work created after the first upgrade')
 await assert.rejects(readFile(join(f.targetHome,'sessions/a.json')),{code:'ENOENT'})
 await writeFile(f.file,JSON.stringify({schemaVersion:1,kind:'wails-host-v1',version:f.settings.productVersion,distribution:f.settings.distribution,sourceHome:f.sourceHome}))
 await assert.rejects(readMigrationLaunch(f),/does not match/)
})
test('retry cannot silently reuse stale history after returning to the old version',async t=>{
 const f=await fixture(t);await importLegacyData(f)
 await writeFile(join(f.sourceHome,'sessions/new.json'),'new work after rollback')
 await assert.rejects(importLegacyData(f),/changed after the previous migration/)
 assert.equal(await readFile(join(f.sourceHome,'sessions/new.json'),'utf8'),'new work after rollback')
 assert.equal(await readFile(join(f.targetHome,'sessions/a.json'),'utf8'),'historical session')
})
test('mismatched release, off-install health paths and duplicate arguments are rejected',async t=>{
 const f=await fixture(t)
 await assert.rejects(readMigrationLaunch({...f,settings:{...f.settings,productVersion:'9.0.0'}}),/does not match/)
 await assert.rejects(readMigrationLaunch({...f,argv:['--eduwork-migration',f.file,'--update-health-file',join(f.root,'health.ok')]}),/location/)
 await assert.rejects(readMigrationLaunch({...f,argv:[...f.argv,'--eduwork-migration',f.file]}),/arguments/)
})
test('filesystem links in retained history cannot escape the installation',async t=>{
 const f=await fixture(t),outside=join(f.root,'external');await mkdir(outside)
 await symlink(outside,join(f.sourceHome,'sessions/link'),process.platform==='win32'?'junction':'dir')
 await assert.rejects(importLegacyData(f),/contains a link/)
 assert.equal(await readFile(join(f.sourceHome,'sessions/a.json'),'utf8'),'historical session')
})
test('canonical path checks do not conceal an internal handshake junction',async t=>{
 const f=await fixture(t),alias=join(f.root,'transaction-alias')
 await symlink(join(f.root,'data/state/updates/transactions/0.3.0'),alias,process.platform==='win32'?'junction':'dir')
 await assert.rejects(readMigrationLaunch({...f,argv:['--eduwork-migration',join(alias,'migration.json'),'--update-health-file',join(alias,'health.ok')]}),/filesystem links/)
 const rootAlias=join(f.root,'root-alias')
 await symlink(f.root,rootAlias,process.platform==='win32'?'junction':'dir')
 await assert.rejects(readMigrationLaunch({...f,argv:['--eduwork-migration',join(rootAlias,'data/state/updates/transactions/0.3.0/migration.json'),'--update-health-file',join(rootAlias,'data/state/updates/transactions/0.3.0/health.ok')]}),/filesystem links/)
})
test('changing source during import fails before making the destination available',async t=>{
 const f=await fixture(t)
 await assert.rejects(importLegacyData({...f,onProgress:()=>writeFile(join(f.sourceHome,'sessions/a.json'),'changed during import')}),/being written|changed/)
 await assert.rejects(readdir(f.targetHome),{code:'ENOENT'})
})
