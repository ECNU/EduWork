import {SpeechService,createSystemSpeechProvider} from './speech.js'
/** Host-only extension seam. Credentials and implementation never reach clients. */
export class MediaProviders {
  speechService = new SpeechService()
  #music = new Map()
  registerSpeech(provider) {return this.speechService.register(provider)}
  registerMusic(track) {
    if (!track?.id || !track.path || !track.license || !track.author || !track.sha256) throw new Error('Music requires id, path, author, license and sha256')
    if (this.#music.has(track.id)) throw new Error(`Duplicate music: ${track.id}`)
    this.#music.set(track.id, {...track})
    return () => this.#music.delete(track.id)
  }
  speech(id='system') {if(!this.speechService.has(id))throw new Error('Speech provider unavailable: '+id);return {synthesize:request=>this.speechService.synthesize({...request,provider:id})}}
  music(id) {const track=this.#music.get(id);if(!track)throw new Error('背景音乐不可用，请重新选择');return track}
  async describe() {
    const speech = await this.speechService.list()
    return {speech,music:[...this.#music.values()].map(({id,title,author,license})=>({id,title,author,license}))}
  }
}

export function normalizeMediaOptions(value = {}) {
  const enabled = (v, fallback) => v === undefined ? fallback : v === true || v === 'true' || v === 'on'
  const narration = enabled(value.narration,true)
  const speed = Number(value.speed ?? 1)
  if (!Number.isFinite(speed) || speed < .25 || speed > 4) throw new Error('语速必须在 0.25–4 之间')
  const volume=(input,fallback)=>{const n=Number(input??fallback);if(!Number.isFinite(n))throw new Error('背景音乐音量必须是有效数字');return Math.max(0,Math.min(1,n))}
  const bgmVolume=volume(value.bgmVolume,.16),duckVolume=Math.min(bgmVolume,volume(value.duckVolume,.06))
  return {narration,subtitles:narration && enabled(value.subtitles,true),provider:String(value.provider || 'system'),voice:String(value.voice || ''),voiceB:String(value.voiceB || ''),speed,
    bgm:String(value.bgm || ''),aspect:['16:9','9:16','1:1'].includes(value.aspect)?value.aspect:'16:9',
    sceneSeconds:Math.max(3,Math.min(30,Number(value.sceneSeconds)||6)),
    bgmVolume,duckVolume}
}

export function createMediaProviders() {
  const providers=new MediaProviders()
  if(process.platform==='win32')providers.registerSpeech(createSystemSpeechProvider())
  return providers
}
