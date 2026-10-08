import { randomUUID } from 'node:crypto'

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function selectedEntry(entries, marker) {
  let found
  for (const entry of entries) {
    if (entry[marker]) found = entry
    if (entry.group && Array.isArray(entry.config)) found = selectedEntry(entry.config, marker) ?? found
  }
  return found
}

// Bake edition object-config defaults into the inserted product entry, where
// prepareProductProfile can still add user organizations and preferences.
// Retaining a later full-config patch would overwrite those runtime additions.
// The pinned Runtime chooses the effective target and checks name guards;
// temporary origin tags identify its source row without reimplementing patches.
export function mergeDistributionConfigPatches(composition, patches, composeEntries) {
  const marker = '__eduworkAssemblyOrigin_' + randomUUID()
  const selection = marker + '_selected'
  const origins = new Map(), replacements = new Set(), result = []
  function mark(entries) {
    for (const entry of entries) {
      entry[marker] = origins.size
      origins.set(entry[marker], entry)
      if (entry.group && Array.isArray(entry.config)) mark(entry.config)
    }
  }
  for (const patch of structuredClone([...composition, ...patches])) {
    // Probe the Runtime's actual target. Its index may still reference a
    // removed child after group-config replacement, so looking up an ID in
    // the resulting tree alone would incorrectly revive a skipped patch.
    const base = patch.id && selectedEntry(composeEntries([result, [
      { id: patch.id, name: patch.name, [selection]: true },
    ]]), selection)
    if (patch.insert) mark(patch.insert)
    if (base?.group && Array.isArray(patch.config)) mark(patch.config)
    const origin = base && origins.get(base[marker])
    const matches = base && (!patch.name || patch.name === base.name)
    if (!patch.insert && matches && !base.group && record(patch.config)
      && (base.config === undefined || record(base.config))) {
      const config = { ...base.config, ...patch.config }
      if (origin && !replacements.has(origin)) {
        origin.config = config
        const { config: ignored, ...rest } = patch
        if (Object.keys(rest).some(key => key !== 'id' && key !== 'name')) result.push(rest)
      } else result.push({ ...patch, config })
    } else {
      // Explicit whole-config replacements keep their normal precedence, even
      // over user defaults. Arrays, null and nested field values are not given
      // a new recursive merge or deletion meaning by the assembly layer.
      if (!patch.insert && matches && Object.hasOwn(patch, 'config') && origin) replacements.add(origin)
      result.push(patch)
    }
  }
  for (const entry of origins.values()) delete entry[marker]
  return result
}
