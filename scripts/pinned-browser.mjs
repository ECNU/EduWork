// The archived npm 0.1.5 recipe keeps its browser; current pinned products use
// the official provider under the same entry ID, preserving activation choices.
export function usePinnedBrowser(distribution) {
  const result = structuredClone(distribution)
  const browser = result.plugins.find(row => row.id === 'eduwork-browser')
  if (browser?.name !== '@chatecnu-work/dsh-tool-browser') throw new Error('Unexpected public browser configuration')
  Object.assign(browser, { source: 'dsh-plugins/browser-upstream', name: '@eduwork/dsh-browser-upstream' })
  result.plugins.push({ root: 'core', source: 'dsh-plugins/client-ui-web-search-product', id: 'eduwork-ui-web-search', name: '@eduwork/dsh-client-ui-web-search-product' })
  result.plugins.push({ root: 'core', source: 'dsh-plugins/tool-browser', id: 'eduwork-search', name: '@chatecnu-work/dsh-tool-browser/search-auto' })
  const searchPatch = result.patches.find(row => row.insert?.some(entry => entry.id === 'eduwork-search'))
  if (searchPatch?.insert.length !== 1) throw new Error('Unexpected public search configuration')
  result.patches = result.patches.filter(row => row !== searchPatch)
  result.patches.push({ id: 'ui-settings-web-search', disabled: true })
  result.patches.push({ insert: [{ id: 'eduwork-browser-use', name: '@deepseek-ai/dsh-browser-use' }] })
  const skill = result.skills.find(row => row.name === 'browser')
  if (!skill) throw new Error('Public browser skill is missing')
  skill.source = 'dsh-skills/browser-upstream'
  return result
}
