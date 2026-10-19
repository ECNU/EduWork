// Match the upstream 16px/currentColor/medium-stroke icon family. The settings
// shell currently selects icons by section id, not by plugin slot metadata.
export function settingsNavigationIcon(id, jsx, jsxs, primitives, className) {
  const props = { className, size: 16 }
  if (id === 'activity-insights') return jsx(primitives.IconUserOutlineMedium, props)
  if (id === 'about') return jsx(primitives.IconInfoOutlineMedium, props)
  const svg = { width: 16, height: 16, className, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true, focusable: false }
  if (id === 'mail-assistant') return jsxs('svg', { ...svg, children: [
    jsx('rect', { x: 1.5, y: 3, width: 13, height: 10, rx: 1.5 }),
    jsx('path', { d: 'm2 4 6 4.5L14 4' }),
  ] })
  if (id === 'desktop-pet') return jsxs('svg', { ...svg, children: [
    jsx('ellipse', { cx: 3, cy: 6, rx: 1.3, ry: 1.7, transform: 'rotate(-20 3 6)' }),
    jsx('ellipse', { cx: 6.3, cy: 3.8, rx: 1.3, ry: 1.7 }),
    jsx('ellipse', { cx: 9.7, cy: 3.8, rx: 1.3, ry: 1.7 }),
    jsx('ellipse', { cx: 13, cy: 6, rx: 1.3, ry: 1.7, transform: 'rotate(20 13 6)' }),
    jsx('path', { d: 'M8 8c-1.5 0-1.9 1.3-3.2 2.3-1.1.9-1.4 2.2-.6 3 .9.9 2.5 0 3.8 0s2.9.9 3.8 0c.8-.8.5-2.1-.6-3C9.9 9.3 9.5 8 8 8Z' }),
  ] })
  if (id === 'personalization') return jsxs('svg', { ...svg, children: [
    jsx('path', { d: 'M8 1.5a6.5 6.5 0 1 0 0 13h.5c1.1 0 1.7-1.2 1-2.1-.7-.8-.3-1.9.8-1.9H12c1.7 0 2.5-1.3 2.5-2.8A6.4 6.4 0 0 0 8 1.5Z' }),
    ...[[4.3, 6], [7, 4.2], [10.2, 4.8], [4.2, 9.5]].map(([cx, cy]) => jsx('circle', { cx, cy, r: .7, fill: 'currentColor', stroke: 'none' }, `${cx}`)),
  ] })
  return null
}
