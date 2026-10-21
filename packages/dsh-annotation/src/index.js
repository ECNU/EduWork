export const name = 'eduwork-annotation'
import { prepareMessage } from './protocol.js'

export function apply(ctx) {
  ctx.on('agent/pre-step', async (_event, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    return { ...decision, messages: decision.messages.map(prepareMessage) }
  })
}
