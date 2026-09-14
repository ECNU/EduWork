// Protocol fixture only. Real product composition is tested separately.
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
const wire = await import(pathToFileURL(process.env.DSH_TEST_HOST_WIRE).href)
const input = createReadStream('', { fd: 3, autoClose: false })
const output = createWriteStream('', { fd: 4, autoClose: false })
const decoder = new wire.DesktopHostRequestDecoder()
const pending = new Map()
let canceled = 0, tail = Promise.resolve(), bootstrap = ''
process.stdin.setEncoding('utf8')
for await (const bytes of process.stdin) bootstrap += bytes
const write = bytes => {
  const sent = tail.then(async () => { if (!output.write(bytes)) await once(output, 'drain') })
  tail = sent.catch(() => {})
  return sent
}
async function respond(id, text, status = 200, headers = []) {
  const bytes = Buffer.from(text)
  await write(wire.encodeDesktopResponseStart(id, { status, headers: [['content-length', String(bytes.length)], ...headers], hasBody: true }))
  for (let index = 0; index < bytes.length; index += 65536) await write(wire.encodeDesktopResponseData(id, bytes.subarray(index, index + 65536)))
  await write(wire.encodeDesktopResponseEnd(id))
}
process.stdout.write('fixture stdout is a log, never a protocol frame\n')
process.send({ type: 'ready', protocolVersion: 3, dshVersion: '0.1.5-rc.1' })
process.on('message', message => { if (message.type === 'shutdown') { for (const item of pending.values()) clearInterval(item.timer); process.exit(0) } })
process.on('disconnect', () => process.exit(0))
input.on('data', bytes => {
  for (const frame of decoder.push(bytes)) {
    if (frame.type === 'start') {
      const url = new URL(frame.url)
      if (url.pathname === '/crash') { process.exit(17); return }
      if (url.pathname === '/status') { void respond(frame.streamId, JSON.stringify({ canceled, active: pending.size })); continue }
      if (url.pathname === '/bootstrap') { void respond(frame.streamId, JSON.stringify({ present: bootstrap === '{"test":"synthetic"}\n' })); continue }
      if (url.pathname === '/oversized') {
        pending.set(frame.streamId, {})
        void write(wire.encodeDesktopResponseStart(frame.streamId, { status: 200, headers: [['content-length', String(33 * 1024 * 1024)]], hasBody: true }))
        continue
      }
      if (url.pathname === '/api/large' || url.pathname === '/api/resized') {
        const total=40*1024*1024
        const range=frame.headers.find(([name])=>name.toLowerCase()==='range')?.[1]?.match(/^bytes=(\d+)-(\d+)$/)
        const start=range?Number(range[1]):0,end=range?Math.min(Number(range[2]),total-1):total-1
        void (async()=>{
          const reportedTotal=total+(url.pathname==='/api/resized'&&frame.method==='GET'?1:0)
          await write(wire.encodeDesktopResponseStart(frame.streamId,{status:range?206:200,headers:[['content-length',String(end-start+1)],['accept-ranges','bytes'],...(range?[['content-range',`bytes ${start}-${end}/${reportedTotal}`]]:[])],hasBody:frame.method!=='HEAD'}))
          if(frame.method!=='HEAD')for(let at=start;at<=end;at+=65536)await write(wire.encodeDesktopResponseData(frame.streamId,Buffer.alloc(Math.min(65536,end-at+1),42)))
          await write(wire.encodeDesktopResponseEnd(frame.streamId))
        })()
        continue
      }
      if (url.pathname === '/.dsh/remote-stream') {
        void write(wire.encodeDesktopResponseStart(frame.streamId, { status: 200, headers: [['content-type', 'application/x-ndjson']], hasBody: true }))
        const state = { events: true, timer: setInterval(() => { void write(wire.encodeDesktopResponseData(frame.streamId, Buffer.from('{"message":"中文事件"}\n'))) }, 5) }
        pending.set(frame.streamId, state)
        continue
      }
      if (url.pathname === '/range' || url.pathname === '/api/range') {
        const bytes = Buffer.from('0123456789abcdef')
        const range = frame.headers.find(([name]) => name.toLowerCase() === 'range')?.[1]
        if (range === 'bytes=3-7') void respond(frame.streamId, bytes.subarray(3, 8), 206, [['content-range', 'bytes 3-7/16'], ['accept-ranges', 'bytes']])
        else void respond(frame.streamId, bytes)
        continue
      }
      if (url.pathname === '/stream' || url.pathname === '/api/stream') {
        void write(wire.encodeDesktopResponseStart(frame.streamId, { status: 200, headers: [['content-type', 'application/octet-stream']], hasBody: true }))
        const state = { timer: setInterval(() => { void write(wire.encodeDesktopResponseData(frame.streamId, Buffer.alloc(4096, 42))) }, 5) }
        pending.set(frame.streamId, state)
        continue
      }
      if (url.pathname === '/echo' && frame.hasBody) {
        pending.set(frame.streamId, {})
        void write(wire.encodeDesktopResponseStart(frame.streamId, { status: 200, headers: [], hasBody: true }))
      } else if (url.pathname === '/slow-upload' && frame.hasBody) {
        pending.set(frame.streamId, { slow: true })
      } else void respond(frame.streamId, 'ok')
    } else if (frame.type === 'data') {
      const item = pending.get(frame.streamId)
      if (item && !item.slow && !item.events) void write(wire.encodeDesktopResponseData(frame.streamId, frame.data))
    } else if (frame.type === 'end') {
      if (pending.get(frame.streamId)?.events) continue
      if (pending.get(frame.streamId)?.slow) void respond(frame.streamId, 'uploaded')
      else void write(wire.encodeDesktopResponseEnd(frame.streamId))
      pending.delete(frame.streamId)
    } else if (frame.type === 'cancel') {
      const item = pending.get(frame.streamId)
      if (item) { canceled++; clearInterval(item.timer); pending.delete(frame.streamId) }
    }
  }
})
