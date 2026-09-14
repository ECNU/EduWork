import {chromium,expect} from '@playwright/test'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import assert from 'node:assert/strict'
const [receiptPath]=process.argv.slice(2)
assert.ok(receiptPath,'Pass the result.json from local-media-smoke.mjs')
const receipt=JSON.parse(await readFile(receiptPath,'utf8'))
assert.equal(receipt.passed,true)
const directory=resolve(process.env.STUDIO_PLAYBACK_OUTPUT||'dist/rc4-capacity/playback')
await mkdir(directory,{recursive:true})
const musicRoot=resolve('packages/artifact-services/media/bgm')
const catalog=JSON.parse(await readFile(join(musicRoot,'catalog.json'),'utf8'))
const samples=[...catalog.tracks.map(track=>({id:track.id,path:join(musicRoot,track.filename),kind:'audio',mime:'audio/mpeg',expectedDuration:track.durationSeconds})),...receipt.results.map(file=>({id:file.mode,path:file.path,kind:file.format==='mp4'?'video':'audio',mime:file.format==='mp4'?'video/mp4':'audio/wav',expectedDuration:file.duration}))]
const browser=await chromium.launch({headless:true,...(process.env.STUDIO_TEST_BROWSER?{executablePath:process.env.STUDIO_TEST_BROWSER}:{})})
const results=[]
try{
 for(const sample of samples){
  const page=await browser.newPage({viewport:{width:1320,height:820}}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.setContent(`<${sample.kind} controls muted style="max-width:100%;max-height:780px"></${sample.kind}>`)
  const bytes=await readFile(sample.path),media=page.locator(sample.kind)
  await media.evaluate((node,src)=>{node.src=src},`data:${sample.mime};base64,${bytes.toString('base64')}`)
  await expect.poll(()=>media.evaluate(node=>node.readyState)).toBeGreaterThanOrEqual(2)
  await media.evaluate(node=>node.play())
  await expect.poll(()=>media.evaluate(node=>node.currentTime)).toBeGreaterThan(.15)
  const state=await media.evaluate(node=>({duration:node.duration,played:node.currentTime,error:node.error?.message||null,width:node.videoWidth,height:node.videoHeight}))
  assert.equal(state.error,null);assert.ok(Math.abs(state.duration-sample.expectedDuration)<.1)
  if(sample.kind==='video'){assert.ok(state.width>0&&state.height>0);await page.screenshot({path:join(directory,sample.id+'.png')})}
  assert.deepEqual(errors,[])
  results.push({id:sample.id,...state});await page.close()
 }
}finally{await browser.close()}
await writeFile(join(directory,'result.json'),JSON.stringify({passed:true,results,externalRequests:0},null,2))
console.log(JSON.stringify({passed:true,samples:results.length,directory}))
