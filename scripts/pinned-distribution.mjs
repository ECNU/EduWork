import calendarSkills from '../config/distributions/calendar-skills.json' with { type: 'json' }
import { usePinnedBrowser } from './pinned-browser.mjs'
import { withPluginNotifications } from './plugin-notification-contract.mjs'

export function pinnedDistribution(generic) {
  const result = withPluginNotifications(usePinnedBrowser(generic))
  for (const skill of calendarSkills) {
    result.packages.push(skill.sourcePackage)
    result.skills.push(structuredClone(skill))
  }
  return result
}
