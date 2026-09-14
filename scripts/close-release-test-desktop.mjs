const url=new URL(process.argv[3])
if (url.hostname !== '127.0.0.1') throw Error('Only a loopback test desktop may be closed')
const version=await (await fetch(new URL('/json/version',url),{signal:AbortSignal.timeout(5000)})).json()
const endpoint=new URL(version.webSocketDebuggerUrl)
if(endpoint.protocol!=='ws:'||endpoint.hostname!=='127.0.0.1'||endpoint.port!==url.port)throw Error('Unexpected desktop debugger endpoint')
// Browser.close can terminate the transport without returning an RPC reply.
// Wait for that close event; the caller separately verifies process termination.
const socket=new WebSocket(endpoint)
await new Promise((resolve,reject)=>{
  let opened=false
  const timer=setTimeout(()=>{socket.close();reject(Error('Test desktop did not disconnect'))},10000)
  socket.onopen=()=>{opened=true;socket.send(JSON.stringify({id:1,method:'Browser.close'}))}
  socket.onclose=()=>{clearTimeout(timer);if(opened)resolve();else reject(Error('Desktop debugger closed before accepting the quit request'))}
  socket.onerror=()=>{clearTimeout(timer);if(opened)resolve();else reject(Error('Desktop debugger connection failed'))}
})
