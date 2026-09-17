import { randomUUID } from 'node:crypto'
import { normalizeMediaConfig } from './config.js'
import { generateImageForAgent, synthesizeSpeechForAgent } from './actions.js'

export const name = 'eduwork-media-openai'
export const inject = ['artifactServices', 'tools', 'agents', 'credentials', 'fs']

function executionFor(ctx, { execution, sessionId, signal }) {
  const agent = execution?.agent || ctx.agents.get(sessionId)
  if (!agent) throw new Error('媒体生成需要有效的对话会话')
  return { ...execution, agent, signal }
}
async function dispatchShared(ctx, name, args, request) {
  const execution = executionFor(ctx, request)
  const result = await ctx.tools.execute({ callId: randomUUID(), rootCallId: execution.rootCallId || execution.callId,
    parent: execution.token, agent: execution.agent, signal: request.signal, name,
    arguments: Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) })
  if (result.isError) throw new Error(result.error?.message || '媒体生成未获批准或生成失败')
  for (const context of result.additionalContexts || []) request.execution?.deferContext?.(context)
  if (result.concludesTurn) request.execution?.concludeTurn?.()
  return JSON.parse(result.value.reportJSON)
}

export function apply(ctx, raw = { providers: [] }) {
  for (const config of normalizeMediaConfig(raw).providers) {
    const available = async () => {
      try {
        if (config.oidcProfileId) return await ctx.get?.('oidcAccounts')?.modelAuthorization?.(config.oidcProfileId, config.baseURL) === true
        return (await ctx.credentials.describe(config.credentialRef)).configured === true
      } catch { return false }
    }
    if (config.speech) {
      const dispose = ctx.artifactServices.registerSpeechProvider({ id: config.id, title: config.title, local: false,
        available, voices: async () => {
          if (!await available()) throw new Error('请先登录对应企业或配置服务凭据')
          return [...config.speech.voices].sort((a, b) => Number(b.id === config.speech.defaultVoice) - Number(a.id === config.speech.defaultVoice))
        },
        async synthesize(request) {
          const { text, speed } = request, voice = request.voice || config.speech.defaultVoice
          if (request.execution?.name !== 'speech_synthesize') return dispatchShared(ctx, 'speech_synthesize', { text, voice, speed, provider: config.id }, request)
          // The shared timeline and audio preview contract uses WAV in both UI paths.
          return synthesizeSpeechForAgent(ctx, config, { input: text, voice, speed, format: 'wav' }, executionFor(ctx, request))
        },
      })
      ctx.effect(() => dispose, `media-openai: speech ${config.id}`)
    }
    if (config.images) {
      const dispose = ctx.artifactServices.registerImageProvider({ id: config.id, title: config.title, local: false, available,
        capabilities: { nativeSizes: config.images.nativeSizes, fitModes: ['crop', 'pad'], customSize: true },
        async generate(request) {
          const { prompt, fit } = request, size = request.size || config.images.defaultSize
          if (request.execution?.name !== 'image_generate') return dispatchShared(ctx, 'image_generate', { prompt, size, fit, provider: config.id }, request)
          return generateImageForAgent(ctx, config, { prompt, size, fit }, executionFor(ctx, request))
        },
      })
      ctx.effect(() => dispose, `media-openai: image ${config.id}`)
    }
  }
  const changed = () => ctx.emit('artifact-services/images-changed')
  ctx.on('credentials/reference-updated', changed)
  ctx.on('credentials/updated', changed)
}
