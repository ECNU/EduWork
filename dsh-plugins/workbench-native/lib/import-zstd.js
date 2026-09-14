// Adapted from DeepSeek Harness (MIT), dsh-v0.1.5-rc.2,
// packages/session/session-persistence-jsonl/src/zstd.ts, scanZstdFrames.
// That helper is not exported by the npm package. Keep the same physical
// frame rules, but reject a torn tail instead of invoking recovery.
export function* sessionFrames(buffer) {
  let offset = 0
  const need = count => { if (buffer.length - offset < count) throw Error(`压缩会话在字节 ${offset} 处截断，请退出来源客户端并重新复制`) }
  while (offset < buffer.length) {
    const start = offset
    need(4)
    if (buffer.readUInt32LE(offset) !== 0xFD2FB528) throw Error(`压缩会话在字节 ${offset} 处包含无效帧`)
    offset += 4; need(1)
    const descriptor = buffer.readUInt8(offset++)
    if (descriptor & 0x18) throw Error('压缩会话包含无效的帧头')
    const flag = descriptor >>> 6, single = Boolean(descriptor & 0x20), dictionary = descriptor & 3
    const headerBytes = (single ? 0 : 1) + (dictionary === 3 ? 4 : dictionary) + (flag === 0 ? (single ? 1 : 0) : 1 << flag)
    need(headerBytes); offset += headerBytes
    for (;;) {
      need(3); const block = buffer.readUIntLE(offset, 3); offset += 3
      const type = (block >>> 1) & 3
      if (type === 3) throw Error('压缩会话包含无效的数据块')
      const size = type === 1 ? 1 : block >>> 3
      need(size); offset += size
      if (block & 1) break
    }
    if (descriptor & 4) { need(4); offset += 4 }
    yield buffer.subarray(start, offset)
  }
}
