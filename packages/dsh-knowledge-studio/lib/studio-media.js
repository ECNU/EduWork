import {renderMedia as render} from '@eduwork/dsh-artifact-services/media'
export {createMediaProviders} from '@eduwork/dsh-artifact-services/providers'
export {waveDuration} from '@eduwork/dsh-artifact-services/speech'
export function renderMedia(artifact,directory,signal,onProgress,providers,context) {
 const segments=artifact.kind==='audio'?artifact.content.segments.map(s=>({...s,heading:artifact.title,bullets:[],narration:s.text})):artifact.content.scenes
 return render({id:artifact.id,kind:artifact.kind,title:artifact.title,segments,options:artifact.parameters},directory,signal,onProgress,providers,context)
}
