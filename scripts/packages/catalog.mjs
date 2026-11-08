export const repository = 'ECNU/EduWork'

// Each development root is installed independently.
// Studio retains its existing shared-services workspace and exact dependency contract.
export const packages = [
  { id: 'dsh-external-agents', name: '@eduwork/dsh-external-agents', directory: 'packages/dsh-external-agents', group: 'dsh-external-agents' },
  { id: 'dsh-decision', name: '@eduwork/dsh-decision', directory: 'packages/dsh-decision', group: 'dsh-decision' },
  { id: 'dsh-annotation', name: '@eduwork/dsh-annotation', directory: 'packages/dsh-annotation', group: 'dsh-annotation' },
  { id: 'dsh-side-chat', name: '@eduwork/dsh-side-chat', directory: 'packages/dsh-side-chat', group: 'dsh-side-chat' },
  { id: 'dsh-desktop-pet', name: '@eduwork/dsh-desktop-pet', directory: 'packages/dsh-desktop-pet', group: 'dsh-desktop-pet' },
  { id: 'dsh-literature', name: '@eduwork/dsh-literature', directory: 'packages/dsh-literature', group: 'dsh-literature' },
  { id: 'dsh-oidc', name: '@eduwork/dsh-oidc', directory: 'packages/dsh-oidc', group: 'dsh-oidc' },
  { id: 'dsh-memory', name: '@eduwork/dsh-memory', directory: 'packages/dsh-memory', group: 'dsh-memory' },
  { id: 'dsh-mail', name: '@eduwork/dsh-mail', directory: 'packages/dsh-mail', group: 'dsh-mail' },
  { id: 'dsh-knowledge-studio', name: '@eduwork/dsh-knowledge-studio', directory: 'packages/dsh-knowledge-studio', group: 'dsh-knowledge-studio' },
  { id: 'dsh-artifact-services', name: '@eduwork/dsh-artifact-services', directory: 'packages/dsh-knowledge-studio/packages/artifact-services', group: 'dsh-knowledge-studio' },
  { id: 'dsh-remote-access', name: '@eduwork/dsh-remote-access', directory: 'packages/dsh-remote-access', group: 'dsh-remote-access' },
]
export const groups = [...new Set(packages.map(p => p.group))]
export function selectPackage(id) {
  const selected = packages.find(p => p.id === id)
  if (!selected) throw new Error(`Unknown package: ${id}. Choose ${packages.map(p => p.id).join(', ')}`)
  return selected
}
export function changedGroups(files) {
  const result = new Set()
  for (const raw of files) {
    const file = raw.replaceAll('\\', '/')
    if (/^packages\/[^/]+\/(?:README(?:_EN)?|AGENTS)\.md$/.test(file)) continue
    if (file.startsWith('scripts/packages/') || file === 'tests/package-maintenance.test.mjs' || /^\.github\/workflows\/packages(?:-release)?\.yml$/.test(file)) {
      groups.forEach(group => result.add(group))
    }
    // Both package checks install this Runtime to exercise their mounted plugins.
    if (/^third_party\/dsh\/[^/]+\/npm-runtime\//.test(file)) {
      result.add('dsh-side-chat')
      result.add('dsh-decision')
    }
    for (const group of groups) if (file.startsWith(`packages/${group}/`)) result.add(group)
    // Side chat consumes the annotation selection service when both are enabled.
    if (file.startsWith('packages/dsh-annotation/')) result.add('dsh-side-chat')
  }
  return groups.filter(group => result.has(group))
}
const sourceDocumentation = /^(?:AGENTS|CONTRIBUTING|README(?:_EN)?|RELEASE-CHECKLIST(?:_EN)?)\.md$/
const productRoots = /^(?:assets|config|dsh-desktop|dsh-electron|dsh-host|dsh-plugins|dsh-presets|dsh-skills|scripts|tests|third_party)\//

export function selectProductChecks(files, { receiptOnly = false, full = false, reason = '' } = {}) {
  const buildInputs = [], integrationInputs = [], unknown = []
  for (const file of files) {
    if (sourceDocumentation.test(file) || /^(?:docs|website|updates)\//.test(file)) continue
    if (file === 'source-receipt.json' && receiptOnly) continue
    if (packages.some(entry => file.startsWith(`${entry.directory}/`))) {
      // Windows native assets are prepared from this source catalog before npm assembly.
      if (file === 'packages/dsh-knowledge-studio/packages/artifact-services/lib/transcription-components.js') buildInputs.push(file)
      // These integration checks read the checkout, rather than the installed npm package.
      if (/^packages\/(?:dsh-desktop-pet|dsh-memory|dsh-knowledge-studio|dsh-oidc|dsh-mail)\//.test(file)
        || file === 'packages/dsh-literature/scripts/probe-runtime.mjs'
        || packages.some(entry => file === `${entry.directory}/package.json`)) integrationInputs.push(file)
      continue
    }
    buildInputs.push(file)
    integrationInputs.push(file)
    if (!productRoots.test(file) && file !== 'source-receipt.json'
      && !['LICENSE', 'LICENSE-MIT', 'LICENSING.md', 'THIRD_PARTY_NOTICES.md'].includes(file)) unknown.push(file)
  }
  const allPackages = full || unknown.length > 0 || files.some(file => ['scripts/ci-changes.mjs', 'scripts/ci-result.mjs', 'tests/ci-changes.test.mjs'].includes(file))
  const selectedGroups = allPackages ? groups : changedGroups(files)
  return {
    build: full || buildInputs.length > 0,
    integration: full || integrationInputs.length > 0,
    groups: selectedGroups,
    packages: selectedGroups.length > 0,
    reasons: {
      build: full ? [reason] : buildInputs.length ? buildInputs : ['No product assembly inputs changed'],
      integration: full ? [reason] : integrationInputs.length ? integrationInputs : ['No integration inputs changed'],
      packages: allPackages ? [reason || 'Shared CI configuration or unknown paths changed'] : selectedGroups,
    },
  }
}

export function needsProductBuild(files, options) {
  return selectProductChecks(files, options).build
}
