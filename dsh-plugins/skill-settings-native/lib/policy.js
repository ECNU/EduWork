const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// Persisted preferences used the former product entry names. Resolve them at
// read/write boundaries; never rename or remove the user's skill files.
export const SKILL_ALIASES = Object.freeze({
  documents: 'artifact-documents',
  spreadsheets: 'artifact-spreadsheets',
  presentations: 'artifact-presentations',
  pdfs: 'artifact-pdfs',
  'ecnu-tts': 'artifact-speech',
  'video-creation': 'artifact-video',
  'ecnu-imagegen': 'artifact-images',
})

export function canonicalSkillName(name) {
  return Object.hasOwn(SKILL_ALIASES, name) ? SKILL_ALIASES[name] : name
}

export function normalizeSkillNames(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(name => typeof name === 'string' && SKILL_NAME.test(name)).map(canonicalSkillName))].sort()
}

export function effectiveDisabledSkills(settings = {}) {
  const disabled = new Set(normalizeSkillNames(settings.disabled))
  const enabled = new Set(normalizeSkillNames(settings.enabled))
  for (const name of normalizeSkillNames(settings.defaultDisabled)) {
    if (!enabled.has(name)) disabled.add(name)
  }
  return disabled
}

export function skillToggleSettings(settings, name, enabled) {
  name = canonicalSkillName(name)
  const disabledNames = new Set(normalizeSkillNames(settings.disabled))
  const enabledNames = new Set(normalizeSkillNames(settings.enabled))
  if (enabled) { disabledNames.delete(name); enabledNames.add(name) }
  else { disabledNames.add(name); enabledNames.delete(name) }
  return { disabled: [...disabledNames].sort(), enabled: [...enabledNames].sort() }
}
