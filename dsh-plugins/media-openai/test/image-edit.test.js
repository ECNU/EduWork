import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {editImage} from '../lib/core.js'
import {apply} from '../lib/index.js'
import {ImageService} from '../../../packages/dsh-knowledge-studio/packages/artifact-services/lib/images.js'

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==','base64')
async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'eduwork-image-edit-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const input=join(root,'input.png'),mask=join(root,'mask.png')
  await writeFile(input,png);await writeFile(mask,png)
  return {root,input,mask}
}
const response=()=>Response.json({data:[{b64_json:png.toString('base64')}]})

test('standard multipart edits send real files and mask; multi-image requests use image[] without JSON encoding',async t=>{
  const f=await fixture(t),calls=[]
  const request={baseURL:'https://example.test/v1',apiKey:'synthetic-key',model:'configured-image',prompt:'Change the background',size:'64x64',nativeSizes:['64x64'],responseFormat:'b64_json',projectPath:f.root,images:[f.input],mask:f.mask,
    requestImpl:async(url,init)=>{calls.push({url,init});return response()}}
  const result=await editImage(request)
  assert.equal(result.format.mime,'image/png')
  assert.equal(calls[0].url,'https://example.test/v1/images/edits')
  assert.equal(calls[0].init.headers.Authorization,'Bearer synthetic-key')
  assert.equal(calls[0].init.headers['Content-Type'],undefined,'Fetch must supply its actual multipart boundary')
  const form=calls[0].init.body
  assert.equal(form.get('model'),'configured-image');assert.equal(form.get('prompt'),request.prompt)
  assert.equal(form.get('size'),'64x64');assert.equal(form.get('response_format'),'b64_json')
  assert.deepEqual(Buffer.from(await form.get('image').arrayBuffer()),png)
  assert.deepEqual(Buffer.from(await form.get('mask').arrayBuffer()),png)
  await editImage({...request,images:[f.input,f.input],mask:undefined,maxImages:2})
  assert.equal(calls[1].init.body.getAll('image[]').length,2)
  assert.equal(calls[1].init.body.get('image'),null)
})

test('editing rejects inaccessible/escaped inputs, invalid masks, provider limits and cancellation before sending',async t=>{
  const f=await fixture(t),other=await fixture(t);let calls=0
  const request={baseURL:'https://example.test/v1',model:'configured-image',prompt:'x',size:'64x64',nativeSizes:['64x64'],projectPath:f.root,images:[f.input],requestImpl:async()=>{calls++;return response()}}
  await assert.rejects(editImage({...request,images:[other.input]}),/outside workspace/)
  await symlink(other.root,join(f.root,'escape'),process.platform==='win32'?'junction':'dir')
  await assert.rejects(editImage({...request,images:[join(f.root,'escape','input.png')]}),/outside workspace/)
  await assert.rejects(editImage({...request,images:[join(f.root,'missing.png')]}),{code:'ENOENT'})
  await assert.rejects(editImage({...request,images:[f.input,f.input]}),/accepts 1/)
  const bad=Buffer.from(png);bad.writeUInt32BE(2,16);await writeFile(f.mask,bad)
  await assert.rejects(editImage({...request,mask:f.mask}),/same dimensions/)
  await writeFile(f.mask,'invalid image')
  await assert.rejects(editImage({...request,mask:f.mask}),/unsupported image/)
  await assert.rejects(editImage({...request,signal:AbortSignal.abort()}),{name:'AbortError'})
  assert.equal(calls,0)
})

test('shared image edit service preserves inputs and rejects unsupported or unavailable providers without regeneration',async t=>{
  const f=await fixture(t),output=join(f.root,'edited.png');await writeFile(output,png)
  const service=new ImageService();let generations=0,edits=0
  service.register({id:'generate-only',generate(){generations++;throw Error('not allowed')}})
  const unregister=service.register({id:'editor',generate(){generations++;throw Error('not allowed')},async edit(request){edits++;assert.equal(request.images[0],f.input);return {path:output}}})
  assert.equal((await service.list()).find(p=>p.id==='editor').capabilities.edit,true)
  const result=await service.edit({prompt:'x',projectPath:f.root,images:[f.input]})
  assert.equal(result.path,output);assert.deepEqual(await readFile(f.input),png)
  await assert.rejects(service.edit({provider:'generate-only',prompt:'x',projectPath:f.root,images:[f.input]}),/does not support editing/)
  unregister()
  service.register({id:'overwrite',generate(){},edit:async()=>({path:f.input})})
  await assert.rejects(service.edit({provider:'overwrite',prompt:'x',projectPath:f.root,images:[f.input]}),/preserve its inputs/)
  assert.equal(generations,0);assert.equal(edits,1)
})

test('dialogue and direct service edits share one tool path and real authorized HTTP multipart transport',async t=>{
  const f=await fixture(t),requests=[],toolCalls=[],service=new ImageService()
  const server=createServer(async(req,res)=>{
    try {
      const chunks=[];for await(const chunk of req)chunks.push(chunk)
      const form=await new Request('http://localhost'+req.url,{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}).formData()
      requests.push({url:req.url,auth:req.headers.authorization,form})
      res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}))
    } catch {res.writeHead(400).end()}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>{server.closeAllConnections();server.close()})
  const baseURL=`http://127.0.0.1:${server.address().port}/v1`,agent={session:{id:'synthetic',header:{cwd:f.root}}}
  const ctx={on(){},emit(){},effect:fn=>t.after(fn()),agents:{get:()=>agent},credentials:{describe:async()=>({configured:true}),resolve:()=>assert.fail('OIDC edits must never read a separate API key')},
    fs:{resolve:async()=>f.root,stat:async()=>({type:'directory'}),processPath:path=>path},
    get:()=>({modelAuthorization:async()=>true,authorizedFetch:async(_id,url,init)=>fetch(url,{...init,headers:{...init.headers,Authorization:'Bearer synthetic-login-token'}})}),
    artifactServices:{registerImageProvider:provider=>service.register(provider)},tools:{execute:async req=>{
      toolCalls.push(req.name)
      return {value:{reportJSON:JSON.stringify(await service.edit({...req.arguments,projectPath:f.root,execution:{...req,name:req.name},signal:req.signal}))}}
    }}}
  apply(ctx,{providers:[{id:'example',protocol:'openai-compatible',baseURL,oidcProfileId:'school',images:{enabled:true,edit:true,model:'configured-image',nativeSizes:['64x64']}}]})
  for(const name of ['image_edit','other-consumer']) {
    const result=await service.edit({prompt:'Change background',images:[f.input],size:'64x64',projectPath:f.root,execution:{name,agent},sessionId:'synthetic'})
    assert.match(result.relativePath,/^\.eduwork\/generated\/images\//)
    assert.equal(result.mime,'image/png');assert.notEqual(result.path,f.input)
  }
  assert.deepEqual(toolCalls,['image_edit']);assert.equal(requests.length,2)
  for(const req of requests) {
    assert.equal(req.url,'/v1/images/edits');assert.equal(req.auth,'Bearer synthetic-login-token')
    assert.equal(req.form.get('model'),'configured-image')
    assert.deepEqual(Buffer.from(await req.form.get('image').arrayBuffer()),png)
  }
  assert.deepEqual(await readFile(f.input),png)
})
