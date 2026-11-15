import { jsx, jsxs } from 'react/jsx-runtime'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { settingsNavigationIcon } from './settings-icon-shapes.js'

// Product defaults for existing section IDs. The shell owns navigation, labels,
// selection and fallback icons; absent sections do not render these entries.
export function registerSettingsIcons(ctx) {
  return ctx.slots.inject('settings.section.icon', function* () {
    for (const id of ['activity-insights', 'about', 'mail-assistant', 'desktop-pet', 'personalization']) {
      yield ctx.slots.register({ name: 'settings.section.icon', id, priority: -100 },
        () => settingsNavigationIcon(id, jsx, jsxs, primitives))
    }
  })
}
