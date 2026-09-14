export const VISUAL_STYLES = Object.freeze(['dsh', 'ecnu-liwa'])

export function normalizeVisualStyle(value) {
  return VISUAL_STYLES.includes(value) ? value : 'dsh'
}
