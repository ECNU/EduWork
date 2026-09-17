import z from '@deepseek-ai/schemastery'
import { normalizeVisualStyle, VISUAL_STYLES } from './core.js'
import {
  DETAILS_PANEL_DEFAULT_WIDTH,
  DETAILS_PANEL_MAX_WIDTH,
  DETAILS_PANEL_MIN_WIDTH,
  normalizeDetailsPanelWidth,
} from './layout-policy.js'
import { assertLauncherPresetRoot, enabledOptionalPresets, OPTIONAL_PRESETS, syncOptionalPresets } from './preset-policy.js'
import { acknowledgeUpstreamWelcomeNotice } from './onboarding-policy.js'

export { normalizeVisualStyle, VISUAL_STYLES } from './core.js'

export const name = 'brand-settings-native'
export const inject = ['settings']
export const SETTINGS_NAMESPACE = 'chatecnu-brand'
export const SettingsSchema = z.object({
  // Product identity is read from the composition base by the Client, never
  // from a historical user's brand override. It has no provider semantics.
  product: z.object({
    name: z.string().default('EduWork'),
    logoUrl: z.string().default(''),
    styleLabels: z.object({
      dsh: z.string().default('蓝色'),
      'ecnu-liwa': z.string().default('红色'),
    }).default({}),
  }).default({}),
  visualStyle: z.union(VISUAL_STYLES).default('ecnu-liwa'),
  enabledOptionalPresets: z.array(z.union(['minimal', 'cordis'])).default([]),
  detailsPanelWidth: z.number()
    .step(1)
    .min(DETAILS_PANEL_MIN_WIDTH)
    .max(DETAILS_PANEL_MAX_WIDTH)
    .default(DETAILS_PANEL_DEFAULT_WIDTH),
})

export async function apply(ctx, raw = {}) {
  await acknowledgeUpstreamWelcomeNotice(ctx.settings, raw.upstreamWelcomeNoticeVersion)
  // The launcher owns a per-home active roster and a read-only product library.
  const managesPresets = raw.manageOptionalPresets ?? Boolean(process.env.DSH_PRODUCT_PRESET_DIR || process.env.DSH_PRODUCT_PRESET_LIBRARY_DIR)
  const scope = ctx.settings.register(SETTINGS_NAMESPACE, SettingsSchema, {
    base: {
      product: raw.product ?? {},
      visualStyle: normalizeVisualStyle(raw.visualStyle),
      enabledOptionalPresets: enabledOptionalPresets(raw.enabledOptionalPresets),
      detailsPanelWidth: normalizeDetailsPanelWidth(raw.detailsPanelWidth),
    },
  })
  if (!managesPresets) return
  await ctx.inject(['agentPresets'], async presetContext => {
    const agentPresets = presetContext.agentPresets
    assertLauncherPresetRoot(agentPresets)
    let pending = Promise.resolve()
    const schedule = (snapshot) => {
      pending = pending.then(() => syncOptionalPresets(snapshot, process.env, agentPresets))
        .catch(error => ctx.logger.error(`brand-settings-native: optional preset sync failed: ${String(error)}`))
      return pending
    }
    await schedule(scope.get())
    presetContext.effect(() => scope.watch(next => schedule(next)), 'optional preset preference watcher')
  })
}

export { OPTIONAL_PRESETS, enabledOptionalPresets, syncOptionalPresets } from './preset-policy.js'
export {
  DETAILS_PANEL_DEFAULT_WIDTH,
  DETAILS_PANEL_MAX_WIDTH,
  DETAILS_PANEL_MIN_WIDTH,
  normalizeDetailsPanelWidth,
} from './layout-policy.js'
export { acknowledgeUpstreamWelcomeNotice, UPSTREAM_WELCOME_NOTICE_NAMESPACE } from './onboarding-policy.js'
