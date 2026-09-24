export const projectURL = 'https://github.com/ECNU/EduWork'

export function feedbackURL(release) {
  const url = new URL(`${projectURL}/issues/new`)
  url.searchParams.set('template', 'bug_report.yml')
  // Allowlist public build facts. Never include inventory paths, profiles,
  // endpoints, credentials, logs or other machine/user data in the URL.
  url.searchParams.set('environment', [
    `${release.productName || 'EduWork'} ${release.productVersion}`,
    release.platform,
    `DSH Core ${release.dshVersion}`,
  ].filter(Boolean).join('\n'))
  return url.href
}

export function visibleComponents(components) {
  return components.filter(item => item.id !== 'desktop-shell')
    .map(item => item.category === 'platform' ? { ...item, category: 'runtime' } : item)
}
