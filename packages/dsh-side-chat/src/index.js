import { SideChatService, SIDE_CHAT_PATH } from './service.js'
export { SideChatService, SideChatError, SIDE_CHAT_PATH } from './service.js'

export const name = 'eduwork-side-chat'
export const inject = ['sessions', 'agents', 'sessionQuery', 'connection', 'systemPrompt']

export function apply(ctx) {
  const service = new SideChatService(ctx)
  ctx.provide('eduworkSideChat', service)
  ctx.effect(() => ctx.connection.fetch.register({
    path: SIDE_CHAT_PATH, methods: ['POST'], requestBody: 'buffered', fetch: request => service.fetch(request),
  }), 'side-chat: owner-only API')
  ctx.effect(() => {
    const timer = setInterval(() => { void service.expire() }, 5_000)
    timer.unref?.()
    return async () => { clearInterval(timer); await service.dispose() }
  }, 'side-chat: owned temporary sessions')
}
