export const DETAILS_PANEL_MIN_WIDTH = 300
export const DETAILS_PANEL_MAX_WIDTH = 1600
export const DETAILS_PANEL_DEFAULT_WIDTH = 360

export function normalizeDetailsPanelWidth(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DETAILS_PANEL_DEFAULT_WIDTH
  return Math.min(DETAILS_PANEL_MAX_WIDTH, Math.max(DETAILS_PANEL_MIN_WIDTH, Math.round(value)))
}
