// Serves the bundled user guide at /eduwork-user-guide/ and stores whether the first-run tour was seen.
// tourSeen is volatile: DSH settings keep it per plugin entry in cordis.patch.yml.
import z from '@deepseek-ai/schemastery'
import { ROUTE, createGuideHandler, tourSettings } from './serve.js'

export { tourSettings }

export const name = 'eduwork-user-guide'
export const inject = ['webServer']

const localeCopy = z.object({
  steps: z.dict(z.object({ title: z.string(), body: z.string() })),
  ui: z.dict(z.string()),
})

export const Config = z.object({
  productName: z.string().default('EduWork'),
  autoStart: z.boolean().default(true),
  copy: z.object({ 'zh-CN': localeCopy, en: localeCopy }),
  tourSeen: z.boolean().default(false).volatile(),
})

export function apply(ctx, config = {}) {
  // No settings form: the tour state is not something users edit.
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: createGuideHandler({ tour: () => tourSettings(config) }) }), 'eduwork-user-guide: route')
}
