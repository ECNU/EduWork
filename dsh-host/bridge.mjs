import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { once } from 'node:events'
import { Decoder, encodeFrame, CHUNK_BYTES, INIT, READY, SHUTDOWN, FATAL, STOPPED, UPLOAD_CREDIT } from './wire.mjs'

const args = process.argv.slice(2)
if (args.length !== 4 || args[0] !== '--adapter' || args[2] !== '--project') throw new Error('Usage: bridge.mjs --adapter <prepared/host-process.mjs> --project <profile>')
const { DesktopHostProcess } = await import(pathToFileURL(resolve(args[1])).href)
const project = resolve(args[3])
let host, initialized = false, ready = false, stopping, lastStreamId = 0
const requests = new Map()
let writeTail = Promise.resolve()
const write = (type, streamId, payload) => {
  const frame = encodeFrame(type, streamId, payload)
  const pending = writeTail.then(async () => {
    if (!process.stdout.write(frame)) await once(process.stdout, 'drain')
  })
  writeTail = pending.catch(() => {})
  return pending
}

async function stop(code = 0) {
  if (stopping) return stopping
  stopping = (async () => {
    for (const state of requests.values()) state.abort.abort(new Error('desktop bridge stopped'))
    requests.clear()
    try { await host?.stop() } catch { code = 1 }
    await write(STOPPED, 0, { code }).catch(() => {})
    process.stdin.destroy()
    process.exitCode = code
  })()
  return stopping
}
async function fatal(error) {
  if (stopping) return
  // Do not echo arbitrary request bodies/bootstrap into protocol diagnostics.
  await write(FATAL, 0, { message: error instanceof Error ? error.message : 'desktop bridge failed' }).catch(() => {})
  await stop(1)
}
process.stdout.on('error', () => { void stop(1) })
process.once('SIGTERM', () => { void stop() })
process.once('SIGINT', () => { void stop() })

async function serve(id, metadata, state, body) {
  try {
    const request = new Request(metadata.url, {
      method: metadata.method, headers: metadata.headers, signal: state.abort.signal,
      ...(body ? { body, duplex: 'half' } : {}),
    })
    const response = await host.fetch(request)
    await write(1, id, { status: response.status, headers: [...response.headers.entries()], hasBody: response.body !== null })
    if (response.body) {
      const reader = response.body.getReader()
      try {
        for (;;) {
          const next = await reader.read()
          if (next.done) break
          for (let offset = 0; offset < next.value.length; offset += CHUNK_BYTES) {
            await write(2, id, Buffer.from(next.value.subarray(offset, offset + CHUNK_BYTES)))
          }
        }
      } finally { reader.releaseLock() }
    }
    await write(3, id)
  } catch (error) {
    if (!state.abort.signal.aborted) await write(4, id, { message: error instanceof Error ? error.message : 'desktop request failed' })
  } finally {
    requests.delete(id)
    state.abort.abort(new Error('desktop response completed'))
    state.finishPull?.()
  }
}

async function accept(frame) {
  const { type, streamId: id, payload } = frame
  if (id === 0) {
    if (type === SHUTDOWN && !payload.length) { void stop(); return }
    if (type !== INIT || initialized) throw new Error('invalid desktop bridge lifecycle frame')
    const options = JSON.parse(payload.toString('utf8'))
    if (options.bridgeProtocolVersion !== 1) throw new Error('unsupported desktop bridge protocol')
    initialized = true
    host = new DesktopHostProcess(process.execPath, project, undefined, {
      bootstrap: options.bootstrap, allowLinkedProfile: options.allowLinkedProfile === true,
      onFailure: error => { if (!stopping) void fatal(error) },
    })
    // Starting is deliberately asynchronous so EOF/shutdown can tear down a failed boot.
    void host.start().then(facts => { ready = true; return write(READY, 0, { ...facts, bridgeProtocolVersion: 1 }) }).catch(fatal)
    return
  }
  if (!ready || stopping) throw new Error('desktop bridge is not ready')
  if (type === 1) {
    if (id <= lastStreamId) throw new Error('desktop stream ids must increase')
    lastStreamId = id
    const metadata = JSON.parse(payload.toString('utf8'))
    if (typeof metadata.url !== 'string' || !metadata.url.startsWith('dsh-app://app/')
      || typeof metadata.method !== 'string' || typeof metadata.hasBody !== 'boolean'
      || !Array.isArray(metadata.headers) || !metadata.headers.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string'))) {
      throw new Error('invalid desktop request metadata')
    }
    const state = { abort: new AbortController(), credit: false, controller: undefined, finishPull: undefined }
    requests.set(id, state)
    const body = metadata.hasBody ? new ReadableStream({
      start(controller) { state.controller = controller },
      async pull() {
        if (state.abort.signal.aborted) return
        state.credit = true
        const consumed = new Promise(resolve => { state.finishPull = resolve })
        await write(UPLOAD_CREDIT, id)
        await consumed
      },
      cancel() { state.controller = undefined; state.finishPull?.() },
    }, { highWaterMark: 0 }) : null
    void serve(id, metadata, state, body).catch(fatal)
    return
  }
  const state = requests.get(id)
  if (!state) {
    if (id > lastStreamId) throw new Error('unknown desktop request stream')
    return // A canceled upload can already have one credited frame in flight.
  }
  if (type === 4 && !payload.length) {
    state.abort.abort(new Error('desktop caller canceled'))
    state.controller?.error(new Error('desktop caller canceled'))
    state.controller = undefined
    state.finishPull?.()
    requests.delete(id)
  } else if ((type === 2 || type === 3) && state.controller && state.credit) {
    if (type === 3 && payload.length) throw new Error('desktop end frame must be empty')
    state.credit = false
    if (type === 2) state.controller.enqueue(payload)
    else { state.controller.close(); state.controller = undefined }
    state.finishPull?.()
    state.finishPull = undefined
  } else throw new Error('invalid or uncredited desktop upload frame')
}

const decoder = new Decoder()
try {
  for await (const chunk of process.stdin) {
    for (const frame of decoder.push(chunk)) await accept(frame)
  }
  decoder.finish()
  await stop()
} catch (error) {
  if (!stopping) await fatal(error)
}
