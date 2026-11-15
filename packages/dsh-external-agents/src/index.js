import {Connections} from './connections.js'

export const name = 'eduwork-external-agents'
export function apply(ctx) {
  ctx.plugin(Connections)
}
