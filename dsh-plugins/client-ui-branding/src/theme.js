export const VISUAL_STYLES = Object.freeze(['dsh', 'ecnu-liwa'])

export function normalizeVisualStyle(value) {
  return VISUAL_STYLES.includes(value) ? value : 'dsh'
}

const pair = (light, dark) => Object.freeze({ light, dark })

// This is an alias-token layer, not a replacement theme engine. DSH still
// owns light/dark/system resolution and every layout/component rule.
export const ECNU_LIWA_TOKENS = Object.freeze({
  '--dsw-alias-bg-base': pair('#fffdfb', '#1d1718'),
  '--dsw-alias-bg-layer-1': pair('#fffaf7', '#251d1f'),
  '--dsw-alias-bg-layer-2': pair('#fbf4ef', '#302426'),
  '--dsw-alias-bg-layer-3': pair('#f7ece7', '#3a2a2d'),
  '--dsw-alias-bg-module-platform': pair('#fbf4ef', '#302426'),
  '--dsw-alias-bg-overlay': pair('#fffdfb', '#2a2022'),
  '--dsw-alias-border-l1': pair('#efe3dc', '#49383c'),
  '--dsw-alias-border-l2': pair('#e5d4cc', '#594247'),
  '--dsw-alias-border-l3': pair('#d4bbb3', '#6d5056'),
  '--dsw-alias-brand-primary': pair('#9f2636', '#e57482'),
  // DSH deliberately keeps a second "business" accent for conversation,
  // workspace and trajectory chrome.  A product visual style must override
  // that family as well; otherwise the shell is Liwa red while send buttons,
  // active folders and preview badges remain DeepSeek blue.
  '--dsw-alias-brand-primary-new-colorprimary-new-color': pair('#9f2636', '#e57482'),
  '--dsw-alias-brand-primary-invert': pair('#ffffff', '#25181b'),
  '--dsw-alias-brand-text': pair('#8f1f30', '#f18a96'),
  '--dsw-alias-button-info-fill': pair('#a52d3d', '#d85d6c'),
  '--dsw-alias-button-info-hover': pair('#861c2b', '#e57482'),
  '--dsw-alias-button-primary-fill': pair('#9f2636', '#bf4555'),
  '--dsw-alias-button-primary-hover': pair('#861c2b', '#d55a69'),
  '--dsw-alias-button-primary-dimmed': pair('#dfb8bc', '#75414a'),
  '--dsw-alias-interactive-bg-active': pair('#f3dfe0', '#523037'),
  '--dsw-alias-interactive-bg-hover': pair('#f8eeea', '#35272a'),
  '--dsw-alias-interactive-bg-hover-accent': pair('#f5e3e3', '#4a2c32'),
  '--dsw-alias-label-primary': pair('#241a18', '#f7eeee'),
  '--dsw-alias-label-primary-bluish': pair('#8f1f30', '#f18a96'),
  '--dsw-alias-label-secondary': pair('#6f5d57', '#cbbabd'),
  '--dsw-alias-label-tertiary': pair('#99847c', '#a99196'),
  '--dsw-alias-state-business-primary': pair('#9f2636', '#e57482'),
  '--dsw-alias-state-business-tertiary': pair('#f5e3e3', '#4a2c32'),
  '--dsw-alias-markdown-code-block': pair('#f8f1ed', '#241c1e'),
  '--dsw-alias-markdown-inline-code': pair('#f2e4df', '#3a292d'),
  '--dsw-specific-sidebar-fill': pair('#faf3ef', '#21191b'),
  '--dsw-specific-bubble': pair('#fbefee', '#432b30'),
  '--dsw-specific-bubble-highlight': pair('#efd5d7', '#663943'),
  '--dsw-specific-sidebar-nav-item-active-accent': pair('#f3dfe0', '#523037'),
  '--dsw-specific-sidebar-nav-item-active': pair('#f0dfe0', '#492c32'),
  '--dsw-specific-sidebar-nav-item-hover': pair('#f8eeea', '#35272a')
})

export function tokensForVisualStyle(value) {
  return normalizeVisualStyle(value) === 'ecnu-liwa' ? ECNU_LIWA_TOKENS : null
}

// Neutral public exports. null means use the official DSH blue tokens; no
// duplicated theme engine. The historical export/key remains for saved prefs.
export const BLUE_TOKENS = null
export const RED_TOKENS = ECNU_LIWA_TOKENS
export const COLOR_SCHEME_TOKENS = Object.freeze({ blue: BLUE_TOKENS, red: RED_TOKENS })
