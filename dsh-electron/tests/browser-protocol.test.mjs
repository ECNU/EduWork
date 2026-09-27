import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {BrowserProtocol} from '../src/browser-protocol.mjs'

function fixture() {
  const windows=new Map(),events=[],commands=[]
  let count=0
  const runtime={async create(){
    const id='owned-'+(++count),window=new EventEmitter(),web=new EventEmitter(),debug=new EventEmitter()
    Object.assign(debug,{attach(){},detach(){},async sendCommand(...args){commands.push(args);return {}}})
    Object.assign(web,{debugger:debug,getTitle:()=>'',getURL:()=>'',printToPDF:async()=>Buffer.from('%PDF-synthetic')})
    window.webContents=web;window.destroy=()=>{windows.delete(id);window.emit('closed')};windows.set(id,window);return id
  },get(id){if(!windows.has(id))throw Error('Unknown browser surface');return windows.get(id)},closeTarget(id){this.get(id).destroy()},close(){for(const window of windows.values())window.destroy()}}
  const protocol=new BrowserProtocol({runtime,emit:event=>events.push(event),version:'152',purpose:'render'})
  return {protocol,events,commands,windows}
}

test('CDP clients cannot inspect, attach or close unowned application targets',async()=>{
  const {protocol,commands,windows}=fixture()
  const {targetId}=await protocol.command({method:'Target.createTarget'})
  const {sessionId}=await protocol.command({method:'Target.attachToTarget',params:{targetId}})
  for(const method of ['Target.getTargetInfo','Target.attachToTarget','Target.closeTarget','Target.activateTarget']) {
    await assert.rejects(protocol.command({method,params:{targetId:'application'}}),/Unknown/)
  }
  await assert.rejects(protocol.command({method:'Runtime.evaluate',sessionId:'foreign'}),/Unknown/)
  await assert.rejects(protocol.command({method:'Target.attachToTarget',sessionId,params:{targetId:'application'}}),/not exposed/)
  await assert.rejects(protocol.command({method:'Browser.crash',sessionId}),/not exposed/)
  await assert.rejects(protocol.command({method:'Page.navigate',sessionId,params:{url:'file:///secret'}}),/Unsupported/)
  assert.equal(commands.length,0)
  protocol.close();assert.equal(windows.size,0)
})

test('PDF stream handles and child sessions are scoped; closing a target emits its id',async()=>{
  const {protocol,events,windows}=fixture()
  const {targetId}=await protocol.command({method:'Target.createTarget'})
  const {sessionId}=await protocol.command({method:'Target.attachToTarget',params:{targetId}})
  const {stream}=await protocol.command({method:'Page.printToPDF',sessionId,params:{transferMode:'ReturnAsStream'}})
  const {targetId:second}=await protocol.command({method:'Target.createTarget'})
  await protocol.command({method:'Target.attachToTarget',params:{targetId:second}})
  await assert.rejects(protocol.command({method:'IO.read',sessionId:second,params:{handle:stream}}),/Unknown/)
  const result=await protocol.command({method:'IO.read',sessionId,params:{handle:stream}})
  assert.equal(Buffer.from(result.data,'base64').toString(),'%PDF-synthetic')
  windows.get(targetId).webContents.debugger.emit('message',{},'Target.attachedToTarget',{sessionId:'child'})
  await assert.rejects(protocol.command({method:'Target.detachFromTarget',sessionId:second,params:{sessionId:'child'}}),/Unknown/)
  await protocol.command({method:'Target.closeTarget',params:{targetId}})
  assert.ok(events.some(event=>event.method==='Target.detachedFromTarget'&&event.params.targetId===targetId))
  assert.equal(protocol.streams.size,0)
  protocol.close()
})
