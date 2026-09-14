// Maintainer-only conversion: retain PCM masters outside the release package.
import assert from 'node:assert/strict'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'

const [ffmpeg,inputDirectory,outputDirectory]=process.argv.slice(2)
assert.ok(ffmpeg&&inputDirectory&&outputDirectory,'Usage: node encode_bgm.mjs <ffmpeg> <PCM catalog directory> <MP3 output directory>')
const source=resolve(inputDirectory),output=resolve(outputDirectory)
assert.notEqual(source,output,'Preserve the PCM masters in a separate directory')
const catalog=JSON.parse(await readFile(join(source,'catalog.json'),'utf8'))
await mkdir(output,{recursive:true})
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const run=args=>execFileSync(ffmpeg,['-hide_banner','-loglevel','error',...args],{windowsHide:true,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']})
for(const track of catalog.tracks){
  assert.equal(track.filename,track.id+'.wav')
  const input=join(source,track.filename),master=await readFile(input)
  assert.equal(sha(master),track.sha256,'PCM integrity: '+track.id)
  const filename=track.id+'.mp3',target=join(output,filename)
  run(['-n','-i',input,'-map_metadata','-1','-c:a','libmp3lame','-b:a','192k','-ar','32000','-ac','2','-write_xing','1',target])
  // Decode independently to measure the released bytes, including gapless trim.
  const wav=run(['-i',target,'-c:a','pcm_s16le','-f','wav','pipe:1'])
  let pcm,sampleRate,channels
  for(let offset=12;offset+8<=wav.length;){
    const id=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4)
    if(id==='fmt '){channels=wav.readUInt16LE(offset+10);sampleRate=wav.readUInt32LE(offset+12)}
    if(id==='data'){pcm=wav.subarray(offset+8,Math.min(wav.length,offset+8+size));break}
    offset+=8+size+(size%2)
  }
  assert.ok(pcm?.length&&sampleRate===32000&&channels===2)
  let peak=0,sum=0,clippedSamples=0,seamPeak=0
  for(let i=0;i<pcm.length;i+=2){const value=pcm.readInt16LE(i)/32768;peak=Math.max(peak,Math.abs(value));sum+=value*value;if(Math.abs(value)>=32767/32768)clippedSamples++}
  for(let c=0;c<channels;c++)seamPeak=Math.max(seamPeak,Math.abs(pcm.readInt16LE(c*2)-pcm.readInt16LE(pcm.length-channels*2+c*2))/32768)
  const duration=pcm.length/(2*channels*sampleRate),rmsDbFS=20*Math.log10(Math.sqrt(sum/(pcm.length/2)))
  assert.ok(Math.abs(duration-track.durationSeconds)<1/sampleRate,'Gapless decoded duration: '+track.id)
  assert.equal(clippedSamples,0)
  assert.ok(Math.abs(rmsDbFS-track.validation.rmsDbFS)<0.5,'Loudness changed: '+track.id)
  assert.ok(seamPeak<0.03,'Loop seam discontinuity: '+track.id)
  track.pcmMaster={sha256:track.sha256,validation:track.validation}
  track.filename=filename;track.mime='mpeg';track.sha256=sha(await readFile(target))
  track.encoding={codec:'mp3',encoder:'libmp3lame',bitrateKbps:192,gaplessMetadata:true}
  track.validation={sampleRate,channels,durationSeconds:duration,peak:Number(peak.toFixed(6)),rmsDbFS:Number(rmsDbFS.toFixed(2)),clippedSamples,loopSeamPeak:Number(seamPeak.toFixed(6))}
  console.log(JSON.stringify({id:track.id,bytes:(await readFile(target)).length,...track.validation}))
}
await writeFile(join(output,'catalog.json'),JSON.stringify(catalog,null,2)+'\n')
