// Serves the bundled user guide at /eduwork-user-guide/ and stores whether the first-run tour was seen.
// tourSeen is volatile: DSH settings keep it per plugin entry in cordis.patch.yml.
import z from '@deepseek-ai/schemastery'
import { ROUTE, createGuideHandler, tourSettings } from './serve.js'

export { tourSettings }

export const name = 'eduwork-user-guide'
export const inject = ['webServer']

const text = z.object({ zh: z.string(), en: z.string() })
const Step = z.object({
  id: z.string().required(),
  title: text,
  body: text,
  // CSS selector of the element to highlight; steps without one are centered.
  selector: z.string(),
})

export const Config = z.object({
  productName: z.string().default('EduWork'),
  autoStart: z.boolean().default(true),
  // Replaces the built-in sequence. Built-in ids keep their target and copy unless overridden.
  steps: z.array(Step).default([]),
  tourSeen: z.boolean().default(false).volatile(),
})

export function apply(ctx, config = {}) {
  // No settings form: the tour state is not something users edit.
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: createGuideHandler({ tour: () => tourSettings(config) }) }), 'eduwork-user-guide: route')
}
