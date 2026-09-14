export const repository = 'ecnu/EduWork'

// Four independently installed development roots, five independently published packages.
// Studio retains its existing shared-services workspace and exact dependency contract.
export const packages = [
  { id: 'dsh-oidc', name: '@eduwork/dsh-oidc', directory: 'packages/dsh-oidc', group: 'dsh-oidc' },
  { id: 'dsh-memory', name: '@eduwork/dsh-memory', directory: 'packages/dsh-memory', group: 'dsh-memory' },
  { id: 'dsh-mail', name: '@eduwork/dsh-mail', directory: 'packages/dsh-mail', group: 'dsh-mail' },
  { id: 'dsh-knowledge-studio', name: '@eduwork/dsh-knowledge-studio', directory: 'packages/dsh-knowledge-studio', group: 'dsh-knowledge-studio' },
  { id: 'dsh-artifact-services', name: '@eduwork/dsh-artifact-services', directory: 'packages/dsh-knowledge-studio/packages/artifact-services', group: 'dsh-knowledge-studio' },
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
    if (/\.(md|png|svg|jpe?g|gif)$/i.test(file)) continue
    if (file.startsWith('scripts/packages/') || file === 'tests/package-maintenance.test.mjs' || /^\.github\/workflows\/packages(?:-release)?\.yml$/.test(file)) {
      groups.forEach(group => result.add(group))
    }
    for (const group of groups) if (file.startsWith(`packages/${group}/`)) result.add(group)
  }
  return groups.filter(group => result.has(group))
}
export function needsProductBuild(files) {
  return files.some(file => !file.startsWith('packages/') && !file.startsWith('scripts/packages/') && !file.startsWith('docs/') && !file.endsWith('.md') && file !== 'tests/package-maintenance.test.mjs' && !/^\.github\/workflows\/packages(?:-release)?\.yml$/.test(file))
}
