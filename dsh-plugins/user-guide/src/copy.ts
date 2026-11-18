import en from '../locales/en.json'
import zh from '../locales/zh-CN.json'

export type GuideLocale = 'zh-CN' | 'en'
export type StepId = keyof typeof en.steps
export type GuideCopy = typeof en
type StepText = { title: string; body: string }
type LocaleOverride = {
  steps?: Partial<Record<StepId, Partial<StepText>>>
  ui?: Partial<GuideCopy['ui']>
}
export type CopyOverrides = Partial<Record<GuideLocale, LocaleOverride>>

function fields<K extends string>(defaults: Record<K, string>, overrides: Partial<Record<K, string>> | undefined, product: string) {
  const result = { ...defaults }
  for (const key of Object.keys(defaults) as K[]) {
    const value = overrides?.[key]
    const text = typeof value === 'string' && value.trim() ? value : defaults[key]
    result[key] = text.replaceAll('{product}', () => product)
  }
  return result
}

/** Overlay only known fields in the requested locale; the built-in document owns the shape. */
export function guideCopy(locale: GuideLocale, overrides: CopyOverrides = {}, product = 'EduWork'): GuideCopy {
  const base = locale === 'zh-CN' ? zh : en
  const local = overrides[locale]
  const steps = { ...base.steps }
  for (const id of Object.keys(steps) as StepId[]) {
    steps[id] = fields(base.steps[id], local?.steps?.[id], product)
  }
  return { steps, ui: fields(base.ui, local?.ui, product) }
}
