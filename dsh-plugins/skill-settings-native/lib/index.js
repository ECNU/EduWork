import z from '@deepseek-ai/schemastery'

export const name = 'skill-settings-native'
export const SETTINGS_NAMESPACE = 'chatecnu-skills'

export const SettingsSchema = z.object({
  disabled: z.array(z.string()).default([]),
  enabled: z.array(z.string()).default([]),
  defaultDisabled: z.array(z.string()).default([]),
})

export const Config = typeof z.string().volatile === 'function'
  ? z.object(Object.fromEntries(Object.entries(SettingsSchema.dict).map(([key, field]) => [key, field.volatile()])))
  : undefined

function baseSettings(raw = {}) {
  return {
    disabled: Array.isArray(raw.disabled)
      ? raw.disabled.map(value => String(value).trim()).filter(Boolean)
      : [],
    enabled: Array.isArray(raw.enabled)
      ? raw.enabled.map(value => String(value).trim()).filter(Boolean)
      : [],
    defaultDisabled: Array.isArray(raw.defaultDisabled)
      ? raw.defaultDisabled.map(value => String(value).trim()).filter(Boolean)
      : [],
  }
}

// This registration deliberately lives in the Host composition instead of an
// Agent preset. The settings screen can therefore maintain the policy before a
// workspace/session exists, while every Agent reads the same durable value.
export function apply(ctx, raw = {}) {
  ctx.inject(['settings'], (settingsCtx) => {
    if (typeof settingsCtx.settings.register !== 'function') return
    settingsCtx.settings.register(SETTINGS_NAMESPACE, SettingsSchema, {
      base: baseSettings(raw),
    })
  })
}
