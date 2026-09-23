import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ArtifactEngine } from './artifacts.js'
import { StudioRegistry } from './capabilities.js'
import { KnowledgeIndexManager } from './manager.js'
import { Config, liveSettings, KnowledgeStudioSettingsSchema, mergeDefaultSettings, SETTINGS_NAMESPACE, validateSettings } from './settings.js'
import { installKnowledgeStudioSkill } from './skill.js'
import { installKnowledgeStudioTools } from './tools.js'
import { mediaParameters } from './capabilities.js'
import {StudioUIPreferences} from './ui-preferences.js'

export const name = 'dsh-knowledge-studio'
const initializers = []

export class KnowledgeStudioService extends TypertRemoteService {
  static Config = Config
  static inject = ['tools', 'workspaceRegistry', 'fs', 'settings', 'skills', 'llm', 'agents', 'agentDefaultModel', 'artifactServices']

  constructor(ctx, config = {}) {
    super(ctx, 'knowledgeStudio')
    this.settingsScope = typeof ctx.settings.register === 'function'
      ? ctx.settings.register(SETTINGS_NAMESPACE, KnowledgeStudioSettingsSchema, {
        base: mergeDefaultSettings(config), applies: 'live', validate: validateSettings,
      })
      : { get: () => liveSettings(config) }
    this.manager = new KnowledgeIndexManager(ctx, config)
    this.mediaProviders = ctx.artifactServices.media
    this.artifacts = new ArtifactEngine(ctx, this.manager, {...config,mediaProviders:this.mediaProviders})
    this.registry = new StudioRegistry()
    this.uiPreferences = new StudioUIPreferences(config.uiPreferencesPath)
    installKnowledgeStudioTools(ctx, this.manager, this.artifacts,{indexedRetrievalTools:config.indexedRetrievalTools===true})
    if(config.skills!==false) {
      const disposeSkill = installKnowledgeStudioSkill(ctx)
      ctx.effect(() => disposeSkill, 'dsh-knowledge-studio: bundled skill')
    }
    ctx.effect(() => async () => {
      await this.artifacts.close()
      await this.manager.close()
    }, 'dsh-knowledge-studio: close tasks and local stores')
    for (const initialize of initializers) initialize.call(this)
  }

  settings() { return this.settingsScope.get() }
  readUIPreferences() { return this.uiPreferences.read() }
  setUIOpenPreference(open) { return this.uiPreferences.set(open) }

  workspace(workspaceId) {
    const workspace = this.ctx.workspaceRegistry.get(workspaceId)
    if (!workspace) throw new Error(`Unknown DSH workspace: ${workspaceId}`)
    return workspace
  }

  async snapshot(workspace) {
    return {
      id: String(workspace.id), title: workspace.title, path: workspace.path,
      capabilities: await this.listCapabilities(),
      artifacts: await this.artifacts.list(workspace.id),
    }
  }

  async workspaceForPath(path) {
    const workspace = await this.ctx.workspaceRegistry.resolveByPath(String(path ?? ''))
    return workspace ? this.snapshot(workspace) : null
  }

  workspaceStatus(workspaceId) {
    return this.snapshot(this.workspace(workspaceId))
  }

  async listCapabilities() {
    await this.ctx.artifactServices.ready
    const media=await this.mediaProviders.describe()
    const runtime=await this.ctx.artifactServices.mediaReadiness()
    const hasSpeech=media.speech.some(p=>p.available&&p.voices.length)
    return this.registry.list().map(cap=>['audio','video'].includes(cap.id)?{
      ...cap,available:runtime.available&&(cap.id==='video'||hasSpeech),
      unavailableReason:!runtime.available?runtime.reason:cap.id==='audio'&&!hasSpeech?'没有可用音色，请先准备本机语音或选择已配置的语音服务。':undefined,
      parameters:[...cap.parameters,...mediaParameters(cap.id,media)],
    }:cap)
  }

  registerSpeechProvider(provider) {return this.mediaProviders.registerSpeech(provider)}
  registerBackgroundMusic(track) {return this.mediaProviders.registerMusic(track)}

  registerStudioCapability(capability, execute) {
    return this.registry.register(capability, execute)
  }

  async readEvidence(workspaceId, evidenceId) {
    return { workspaceId, evidence: await this.manager.readEvidence(this.workspace(workspaceId), evidenceId) }
  }

  async invokeStudio(workspaceId, capabilityId, parameters, sessionId) {
    const workspace = this.workspace(workspaceId)
    const capability = this.registry.get(capabilityId)
    if (!capability) throw new Error(`Unknown Studio capability: ${capabilityId}`)
    if (!capability.available) throw new Error(`${capability.title} is not available in this build yet`)
    if (typeof capability.execute === 'function') {
      return capability.execute({ ctx: this.ctx, workspace, parameters: parameters ?? {}, sessionId, manager: this.manager })
    }
    if (capability.execution === 'conversation') {
      return { action: 'compose', prompt: capability.prompt, capabilityId: capability.id }
    }
    if (capability.execution === 'artifact') {
      return { action: 'artifact', capabilityId: capability.id, artifact: await this.artifacts.start(workspace, capability.id, parameters, sessionId) }
    }
    throw new Error(`Studio capability has no executor: ${capability.id}`)
  }

  async listArtifacts(workspaceId) {
    this.workspace(workspaceId)
    return { workspaceId, artifacts: await this.artifacts.list(workspaceId) }
  }

  async readArtifact(artifactId) {
    return { artifact: await this.artifacts.read(artifactId) }
  }

  async updateArtifactInteraction(artifactId, action, itemId, value) {
    return { artifact: await this.artifacts.interaction(artifactId, action, itemId, value) }
  }

  async artifactAskPrompt(artifactId, itemId) {
    return { prompt: await this.artifacts.askPrompt(artifactId, itemId) }
  }

  async manageArtifact(artifactId, action, value, sessionId) {
    return { artifact:await this.artifacts.manage(artifactId,action,value,sessionId) }
  }
  async exportArtifact(artifactId, format) {
    return { file:await this.artifacts.export(artifactId,format) }
  }

}

const remoteMethods = [
  'readUIPreferences', 'setUIOpenPreference',
  'workspaceForPath', 'workspaceStatus', 'listCapabilities',
  'readEvidence', 'invokeStudio',
  'listArtifacts', 'readArtifact', 'updateArtifactInteraction', 'artifactAskPrompt', 'manageArtifact', 'exportArtifact',
]

for (const method of remoteMethods) {
  Remote(method)(KnowledgeStudioService.prototype[method], {
    kind: 'method', name: method, static: false, private: false,
    addInitializer(initializer) { initializers.push(initializer) },
  })
}

export { StudioRegistry } from './capabilities.js'
export { KnowledgeIndexManager } from './manager.js'
export { WorkspaceKnowledgeStore } from './store.js'
export default KnowledgeStudioService
