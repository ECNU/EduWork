/** Duration is measured from the actual WAV bytes, never a provider estimate. */
export function waveDuration(buffer) {
  if(buffer.length<44 || buffer.toString('ascii',0,4)!=='RIFF' || buffer.toString('ascii',8,12)!=='WAVE')throw new Error('语音适配器必须返回 WAV 音频')
  let rate=0, bytes=0
  for(let offset=12;offset+8<=buffer.length;) {
    const name=buffer.toString('ascii',offset,offset+4),size=buffer.readUInt32LE(offset+4)
    if(offset+8+size>buffer.length)throw new Error('WAV 音频不完整')
    if(name==='fmt '&&size<16)throw new Error('WAV 格式头不完整')
    if(name==='fmt ')rate=buffer.readUInt32LE(offset+16)
    if(name==='data')bytes=size
    offset+=8+size+(size%2)
  }
  if(!rate||!bytes)throw new Error('语音输出不是有效 WAV 文件')
  return bytes/rate
}
