import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp,mkdir,writeFile,readFile,readdir,rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareWailsLegacyHome } from '../wails-migration.mjs'

test('first bridge launch preserves legacy data and later launches retain new conversations',async t=>{
 const root=await mkdtemp(join(tmpdir(),'bridge-data-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const source=join(root,'data/dsh'),target=join(root,'data/eduwork-chatecnu-wails/dsh')
 await mkdir(join(source,'sessions'),{recursive:true});await mkdir(join(source,'profiles'),{recursive:true})
 await writeFile(join(source,'sessions/old.jsonl'),'old conversation\n');await writeFile(join(source,'profiles/old.json'),'do not activate')
 const args={root,distribution:'eduwork-chatecnu',version:'0.3.0'}
 const result=await prepareWailsLegacyHome(args);assert.equal(result.state,'imported');assert.equal(result.files,1)
 assert.equal(await readFile(join(target,'sessions/old.jsonl'),'utf8'),'old conversation\n')
 assert.equal(await readFile(join(source,'sessions/old.jsonl'),'utf8'),'old conversation\n')
 await writeFile(join(target,'sessions/new.jsonl'),'created in bridge')
 assert.equal((await prepareWailsLegacyHome(args)).state,'existing')
 assert.equal(await readFile(join(target,'sessions/new.jsonl'),'utf8'),'created in bridge')
 await assert.rejects(readFile(join(target,'profiles/old.json')),{code:'ENOENT'})
})

test('a pre-existing unowned home is never overwritten',async t=>{
 const root=await mkdtemp(join(tmpdir(),'bridge-data-'));t.after(()=>rm(root,{recursive:true,force:true}))
 await mkdir(join(root,'data/eduwork-wails/dsh'),{recursive:true})
 await assert.rejects(prepareWailsLegacyHome({root,distribution:'eduwork',version:'0.3.0'}),/未自动合并/)
})

test('failed GUI bootstrap cache is retained separately and no longer blocks import',async t=>{
 const root=await mkdtemp(join(tmpdir(),'bridge-gui-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const source=join(root,'data/dsh'),base=join(root,'data/eduwork-wails'),target=join(base,'dsh')
 await mkdir(join(source,'attachments'),{recursive:true});await writeFile(join(source,'attachments/note.txt'),'old attachment')
 await mkdir(join(target,'webview2/Default'),{recursive:true});await writeFile(join(target,'webview2/Default/Preferences'),'browser preference')
 await mkdir(join(target,'logs'));await writeFile(join(target,'logs/startup-error.log'),'earlier failure')
 assert.equal((await prepareWailsLegacyHome({root,distribution:'eduwork',version:'0.3.0'})).state,'imported')
 const preserved=(await readdir(base)).find(name=>name.startsWith('.startup-before-migration-'));assert.ok(preserved)
 assert.equal(await readFile(join(base,preserved,'webview2/Default/Preferences'),'utf8'),'browser preference')
 assert.equal(await readFile(join(target,'attachments/note.txt'),'utf8'),'old attachment')
 assert.equal(await readFile(join(source,'attachments/note.txt'),'utf8'),'old attachment')
})

test('bootstrap recovery never reclassifies real session data as cache',async t=>{
 const root=await mkdtemp(join(tmpdir(),'bridge-gui-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const target=join(root,'data/eduwork-wails/dsh')
 await mkdir(join(target,'webview2'),{recursive:true});await mkdir(join(target,'sessions'))
 await writeFile(join(target,'sessions/new.jsonl'),'keep this session')
 await assert.rejects(prepareWailsLegacyHome({root,distribution:'eduwork',version:'0.3.0'}),/未自动合并/)
 assert.equal(await readFile(join(target,'sessions/new.jsonl'),'utf8'),'keep this session')
})
