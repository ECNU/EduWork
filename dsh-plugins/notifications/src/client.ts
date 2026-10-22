import { Service } from '@deepseek-ai/cordis'
import { NotificationActions } from '../lib/client-actions.js'
export function apply(ctx) {
  const service = new Service(ctx, 'notificationActions')
  const actions = new NotificationActions()
  service.register = (source, handler, visible) => actions.register(source, handler, visible)
  service.dispatch = action => actions.dispatch(action)
  service.visible = () => actions.visible()
  ctx.effect(() => () => actions.close())
}
