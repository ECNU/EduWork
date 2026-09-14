export const MAGIC = 0x44534833
export const CHUNK_BYTES = 65536
export const MAX_METADATA = 1024 * 1024
export const INIT = 128
export const READY = 128
export const SHUTDOWN = 129
export const FATAL = 129
export const STOPPED = 130
export const UPLOAD_CREDIT = 5

export function encodeFrame(type, streamId, payload = Buffer.alloc(0)) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload))
  const max = type === 2 ? CHUNK_BYTES : MAX_METADATA
  if (!Number.isInteger(streamId) || streamId < 0 || streamId > 0xffffffff || data.length > max) throw new Error('invalid desktop bridge frame')
  const frame = Buffer.allocUnsafe(13 + data.length)
  frame.writeUInt32BE(MAGIC, 0)
  frame[4] = type
  frame.writeUInt32BE(streamId, 5)
  frame.writeUInt32BE(data.length, 9)
  data.copy(frame, 13)
  return frame
}

export class Decoder {
  #buffer = Buffer.alloc(0)
  push(bytes) {
    this.#buffer = Buffer.concat([this.#buffer, bytes])
    const result = []
    while (this.#buffer.length >= 13) {
      const buffer = this.#buffer
      if (buffer.readUInt32BE(0) !== MAGIC) throw new Error('desktop bridge frame magic mismatch')
      const type = buffer[4], streamId = buffer.readUInt32BE(5), length = buffer.readUInt32BE(9)
      if (length > (type === 2 ? CHUNK_BYTES : MAX_METADATA)) throw new Error('desktop bridge frame exceeds limit')
      if (buffer.length < 13 + length) break
      result.push({ type, streamId, payload: Buffer.from(buffer.subarray(13, 13 + length)) })
      this.#buffer = buffer.subarray(13 + length)
    }
    return result
  }
  finish() { if (this.#buffer.length) throw new Error('truncated desktop bridge frame') }
}
