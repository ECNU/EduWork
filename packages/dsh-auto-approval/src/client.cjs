// Client part: an icon for the auto-approval preset in the composer's permission menu and on its control, where DSH
// shows icons for its own presets. DSH takes those from a fixed table of its four built-in presets (0.2.2-rc.3 too), so
// the icon is added to the page, before the preset's label: in a menu as a copy of a sibling item's icon slot, which
// keeps DSH's place and styles for it, on the control as a plain one. Nothing of DSH's is changed. Where the page is
// not as expected, or DSH draws an icon of its own there, none is added and an added one is taken away.

// The preset the README configures: the client part gets no plugin config to read another from.
const PRESET = 'auto-approval'
const MARK = 'data-eduwork-auto-approval-icon'
// A shield like the built-in presets', with a spark for the model that reviews; one-pixel lines in the text colour.
const svg = size => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linejoin="round">`
  + '<path d="M6.6 2.15a3.4 3.4 0 0 1 2.8 0l4.52 1.7v3.27c0 4.49-3.37 6.48-5.92 7.46-2.56-.98-5.93-2.97-5.93-7.46V3.84z"/>'
  + '<path d="M8 4.8C8.25 6.65 9.05 7.45 10.9 7.7 9.05 7.95 8.25 8.75 8 10.6 7.75 8.75 6.95 7.95 5.1 7.7 6.95 7.45 7.75 6.65 8 4.8z"/></svg>'

exports.apply = ctx => {
  // Injected here rather than declared, so that the part is active whatever DSH provides: without these, no icon.
  ctx.inject(['connection', 'remote', 'remote.permissionPresets'], scope => {
    // Where the preset is in the catalog DSH's menu is drawn from, and its name, which its menu item and the control
    // show; read again when the catalog or the Host connection changes. The control shows only the name, so with another
    // preset of that name, there is no telling which one it is.
    let preset, reads = 0
    const read = async () => {
      const read = ++reads
      const result = await scope.remote.permissionPresets.catalog().catch(() => undefined)
      if (read !== reads) return
      const options = result?.ok ? result.value.options : []
      const index = options.findIndex(option => option.value === PRESET), name = options[index]?.name
      preset = name && options.filter(option => option.name === name).length === 1 ? { name, index, count: options.length } : undefined
      update(preset)
    }
    const observer = new MutationObserver(() => update(preset))
    scope.effect(() => {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      const stopCatalog = scope.remote.$on('permission-presets/catalog-changed', read)
      const stopConnection = scope.connection.generation.subscribe(read)
      read()
      return () => {
        reads++
        stopCatalog()
        stopConnection()
        observer.disconnect()
        update(undefined)
      }
    })
  })
}

// The icon before the preset's label on the control and in its permission menu; any other added icon is taken away.
function update(preset) {
  const icons = new Set()
  if (preset) {
    const { name, index, count } = preset
    for (const button of document.querySelectorAll('[data-slot="conversation.input.permission"] button')) icons.add(place(button, name))
    // The menu is a portal of its own, tied to the control in nothing on the page; it is told by its items, one for each
    // preset in the catalog, in order. It has icons when DSH drew one for an item: the item's first child, an svg in it.
    for (const menu of document.querySelectorAll('[role=menu]')) {
      const items = [...menu.querySelectorAll('[role=menuitem]')]
      const slot = items.map(item => item.firstElementChild).find(first => first && !first.hasAttribute(MARK) && first.querySelector('svg'))
      if (slot && items.length === count) icons.add(place(items[index], name, slot))
    }
  }
  for (const icon of document.querySelectorAll(`[${MARK}]`)) if (!icons.has(icon)) icon.remove()
}

// What is before the child of `element` showing `name`: the icon there, or DSH's own element, which `update` leaves
// alone; else a new icon.
function place(element, name, slot) {
  const label = [...element.children].find(child => child.textContent === name)
  const before = label?.previousElementSibling
  if (!label || before) return before
  const icon = slot ? slot.cloneNode(false) : document.createElement('span')
  if (!slot) icon.style.cssText = 'flex:none;display:inline-flex'
  icon.setAttribute(MARK, '')
  icon.setAttribute('aria-hidden', 'true')
  icon.innerHTML = svg(slot ? 16 : 14)
  label.before(icon)
  return icon
}
