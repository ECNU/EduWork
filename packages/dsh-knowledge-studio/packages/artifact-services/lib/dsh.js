import {Service} from '@deepseek-ai/cordis'
import {createMediaProviders} from './providers.js'
import {apply as installOfficeTools} from './office-tools.js'
import {installMediaTools} from './media-tools.js'
import {loadMusicCatalog} from './music.js'
import {installArtifactSkills} from './skills.js'
import {TranscriptionService} from './transcription.js'
import {createWhisperCppTranscriptionProvider} from './transcription-whisper.js'
import {installTranscriptionTools} from './transcription-tools.js'
import {ImageService} from './images.js'
import {installImageTools} from './image-tools.js'
import {inspectMediaRuntime} from './runtime.js'

export const name='dsh-artifact-services'
export class ArtifactServices extends Service {
  static inject=['tools','fs','permissionPresets','skills']
  constructor(ctx,config={}) {
    super(ctx,'artifactServices')
    this.media=createMediaProviders()
    this.speech=this.media.speechService
    this.imageGenerationEnabled=config.images?.enabled===true
    this.images=new ImageService({enabled:this.imageGenerationEnabled,onChange:()=>this.refreshImageProviders()})
    this.transcription=new TranscriptionService()
    this.registerTranscriptionProvider(createWhisperCppTranscriptionProvider(config.transcription?.local))
    this.ready=loadMusicCatalog(this.media,config.bgmRoot)
    installOfficeTools(ctx)
    installMediaTools(ctx,this)
    installTranscriptionTools(ctx,this)
    if(this.imageGenerationEnabled)installImageTools(ctx,this)
    if(config.skills!==false) {
      const dispose=installArtifactSkills(ctx,{images:this.imageGenerationEnabled?this.images:undefined})
      ctx.effect(()=>dispose,'dsh-artifact-services: skills')
    }
  }
  registerSpeechProvider(provider) {return this.media.registerSpeech(provider)}
  mediaReadiness() {return inspectMediaRuntime()}
  registerImageProvider(provider) {return this.images.register(provider)}
  refreshImageProviders() {this.ctx.emit('artifact-services/images-changed')}
  registerTranscriptionProvider(provider) {return this.transcription.register(provider)}
  registerBackgroundMusic(track) {return this.media.registerMusic(track)}
}
export default ArtifactServices
