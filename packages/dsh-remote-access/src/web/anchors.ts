/**
 * CSS anchor positioning for browsers without it: Safari before 26 (so iOS and
 * iPadOS before 26) and Chromium before 125. DSH places its menus, pickers and
 * usage cards next to their triggers with `anchor-name`, `position-anchor` and
 * `anchor()`. Such a browser drops those declarations, and each card lands in
 * a corner of the window instead.
 *
 * Here the anchor declarations, inline or in stylesheets, are kept as custom
 * properties the browser does keep, and every anchored card is placed next to
 * its anchor: on the side with room for it, aligned with the anchor's nearer
 * edge, inside the window. DSH's own `anchor()` rules are not evaluated.
 */

const NAME = '--eduwork-anchor-name'
const ANCHOR = '--eduwork-position-anchor'
const STAND_INS = new Map([['anchor-name', NAME], ['position-anchor', ANCHOR]])
/** The window margin and the anchor gap, as in DSH's own placements. */
const MARGIN = 12
const GAP = 4
/** A placed card carries its placement in these properties, applied by one rule; nothing of its own is overwritten. */
const PLACED = 'data-eduwork-anchored'
const TOP = '--eduwork-anchored-top', LEFT = '--eduwork-anchored-left'
const MAX_WIDTH = '--eduwork-anchored-max-width', MAX_HEIGHT = '--eduwork-anchored-max-height'
const PLACEMENT = `[${PLACED}]{top:var(${TOP})!important;left:var(${LEFT})!important;right:auto!important;bottom:auto!important}
[${PLACED}~=narrow]{max-width:var(${MAX_WIDTH})!important}
[${PLACED}~=short]{max-height:var(${MAX_HEIGHT})!important}`

interface Box { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number }

/** The index of the quote that closes the CSS string opening at `start`. */
function stringEnd(text: string, start: number): number {
  let end = start + 1
  while (end < text.length && text[end] !== text[start]) end += text[end] === '\\' ? 2 : 1
  return end
}

/** The selectors of a selector list, split at its top-level commas. */
function selectors(list: string): string[] {
  const found: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (c === '\\') i++
    else if (c === '"' || c === '\'') i = stringEnd(list, i)
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      found.push(list.slice(start, i).trim())
      start = i + 1
    }
  }
  found.push(list.slice(start).trim())
  return found
}

/**
 * The anchor declarations of a stylesheet as custom-property rules under the
 * same selectors and conditions, and the selectors of anchors and of cards.
 */
export function anchorRules(css: string): { css: string; anchors: string[]; cards: string[] } {
  const rules: string[] = [], anchors: string[] = [], cards: string[] = []
  const open: string[] = []
  let text = ''
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      i = end < 0 ? css.length : end + 1
    } else if (c === '"' || c === '\'') {
      const end = stringEnd(css, i)
      text += css.slice(i, end + 1)
      i = end
    } else if (c === '\\') {
      text += css.slice(i, i + 2)
      i++
    } else if (c === '{') {
      open.push(text.trim())
      text = ''
    } else if (c === ';' || c === '}') {
      const [, name, value] = /^\s*(anchor-name|position-anchor)\s*:([^]*)$/.exec(text) ?? []
      if (name !== undefined && value !== undefined && open.length > 0) {
        const property = STAND_INS.get(name)!
        rules.push(`${open.join('{')}{${property}:${value.trim()}${'}'.repeat(open.length)}`)
        ;(property === NAME ? anchors : cards).push(...selectors(open.at(-1)!))
      }
      if (c === '}') open.pop()
      text = ''
    } else {
      text += c
    }
  }
  return { css: rules.join('\n'), anchors, cards }
}

/**
 * Where a card of the given size goes next to its anchor, in viewport
 * coordinates: below or above, whichever fits (the roomier one when both or
 * neither do), capped to the window's width and to the room it gets.
 */
export function placement(anchor: Box, card: { width: number; height: number }, viewport: { width: number; height: number }): { top: number; left: number; maxWidth?: number; maxHeight?: number } {
  const below = viewport.height - MARGIN - GAP - anchor.bottom
  const above = anchor.top - GAP - MARGIN
  const fitsBelow = card.height <= below
  const down = fitsBelow === card.height <= above ? below >= above : fitsBelow
  const room = Math.max(0, down ? below : above)
  const height = Math.min(card.height, room)
  const span = viewport.width - 2 * MARGIN
  const width = Math.min(card.width, span)
  const end = anchor.left + anchor.right > viewport.width
  const left = Math.max(MARGIN, Math.min(end ? anchor.right - width : anchor.left, viewport.width - MARGIN - width))
  return {
    top: down ? anchor.bottom + GAP : anchor.top - GAP - height, left,
    ...card.width > span && { maxWidth: span },
    ...card.height > room && { maxHeight: room },
  }
}

function install(): void {
  for (const name of STAND_INS.values()) CSS.registerProperty({ name, syntax: '*', inherits: false })
  const lookup = { anchors: new Set([`[style*="${NAME}"]`]), cards: new Set([`[style*="${ANCHOR}"]`]) }

  // Inline styles: DSH's React components set `style.anchorName` and
  // `style.positionAnchor`, and its menus call `setProperty('anchor-name', …)`.
  const proto = CSSStyleDeclaration.prototype
  const { setProperty, getPropertyValue, getPropertyPriority, removeProperty } = proto
  const standIn = (property: string): string => STAND_INS.get(property) ?? property
  Object.assign(proto, {
    setProperty(this: CSSStyleDeclaration, property: string, value: string | null, priority?: string) {
      setProperty.call(this, standIn(property), value, priority)
    },
    getPropertyValue(this: CSSStyleDeclaration, property: string) { return getPropertyValue.call(this, standIn(property)) },
    getPropertyPriority(this: CSSStyleDeclaration, property: string) { return getPropertyPriority.call(this, standIn(property)) },
    removeProperty(this: CSSStyleDeclaration, property: string) { return removeProperty.call(this, standIn(property)) },
  })
  for (const [property, name] of STAND_INS) {
    Object.defineProperty(proto, property.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase()), {
      configurable: true,
      enumerable: true,
      get(this: CSSStyleDeclaration) { return getPropertyValue.call(this, name) },
      set(this: CSSStyleDeclaration, value: string | null) { setProperty.call(this, name, value ?? '') },
    })
  }

  // Stylesheets: the browser keeps their text, not the declarations it dropped.
  const read = new WeakSet<Element>()
  const sheetOf = (css: string): HTMLStyleElement => {
    const style = document.createElement('style')
    read.add(style)
    style.textContent = css
    return style
  }
  const copy = (sheet: Element, css: string): void => {
    const rules = anchorRules(css)
    // One selector this browser cannot parse would void the whole lookup.
    for (const selector of rules.anchors) if (CSS.supports(`selector(${selector})`)) lookup.anchors.add(selector)
    for (const selector of rules.cards) if (CSS.supports(`selector(${selector})`)) lookup.cards.add(selector)
    if (rules.css === '') return
    sheet.after(sheetOf(rules.css))
    schedule()
  }
  const readSheet = (node: Element): void => {
    if (read.has(node)) return
    if (node instanceof HTMLStyleElement) {
      read.add(node)
      copy(node, node.textContent ?? '')
    } else if (node instanceof HTMLLinkElement && node.relList.contains('stylesheet') && node.href !== '') {
      read.add(node)
      fetch(node.href)
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.text()
        })
        .then(css => copy(node, css), error => console.error('anchor positioning fallback cannot read', node.href, error))
    }
  }

  let rule: HTMLStyleElement | undefined
  const placed = new Set<HTMLElement>()
  const release = (card: HTMLElement): void => {
    card.removeAttribute(PLACED)
    for (const property of [TOP, LEFT, MAX_WIDTH, MAX_HEIGHT]) card.style.removeProperty(property)
    placed.delete(card)
  }
  const place = (card: HTMLElement, anchor: Element): void => {
    rule ??= document.head.appendChild(sheetOf(PLACEMENT))
    placed.add(card)
    // Measure the card at its own size, at the origin of its containing block.
    const { style } = card
    card.setAttribute(PLACED, '')
    style.setProperty(TOP, '0px')
    style.setProperty(LEFT, '0px')
    const origin = card.getBoundingClientRect()
    const root = document.documentElement
    const to = placement(anchor.getBoundingClientRect(), origin, { width: root.clientWidth, height: root.clientHeight })
    style.setProperty(TOP, `${to.top - origin.top}px`)
    style.setProperty(LEFT, `${to.left - origin.left}px`)
    if (to.maxWidth !== undefined) style.setProperty(MAX_WIDTH, `${to.maxWidth}px`)
    if (to.maxHeight !== undefined) style.setProperty(MAX_HEIGHT, `${to.maxHeight}px`)
    card.setAttribute(PLACED, `${to.maxWidth === undefined ? '' : 'narrow'} ${to.maxHeight === undefined ? '' : 'short'}`.trim())
  }

  // While any card is anchored, follow it every frame, as native anchor
  // positioning does: scrolling, the keyboard and its own content all move or
  // resize it without a DOM change. Only elements with a layout box take part.
  let frame = 0
  const schedule = (): void => {
    frame ||= requestAnimationFrame(update)
  }
  const update = (): void => {
    frame = 0
    const named = new Map<string, Element>()
    for (const anchor of document.querySelectorAll([...lookup.anchors].join())) {
      if (anchor.getClientRects().length === 0) continue
      for (const name of getComputedStyle(anchor).getPropertyValue(NAME).split(',')) if (name.trim() !== '') named.set(name.trim(), anchor)
    }
    const cards = new Map<HTMLElement, Element>()
    for (const card of document.querySelectorAll<HTMLElement>([...lookup.cards].join())) {
      const computed = getComputedStyle(card)
      const anchor = named.get(computed.getPropertyValue(ANCHOR).trim())
      if (anchor === undefined || card.contains(anchor) || card.getClientRects().length === 0 || computed.visibility === 'hidden'
        || (computed.position !== 'fixed' && computed.position !== 'absolute')) continue
      cards.set(card, anchor)
    }
    for (const card of placed) if (!cards.has(card)) release(card)
    for (const [card, anchor] of cards) place(card, anchor)
    if (cards.size > 0) schedule()
  }

  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue
        readSheet(node)
        for (const sheet of node.querySelectorAll('style, link')) readSheet(sheet)
      }
    }
    schedule()
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] })
  for (const sheet of document.querySelectorAll('style, link')) readSheet(sheet)
}

// Firefox 113–127 lacks registered properties; its cards stay unplaced rather than the preamble stopping.
if (typeof CSS !== 'undefined' && !CSS.supports('anchor-name', '--a') && typeof CSS.registerProperty === 'function') install()
