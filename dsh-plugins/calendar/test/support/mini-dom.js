// A minimal DOM, enough for `react-dom/client` to mount a tree and run effects.
//
// There is no jsdom in the pinned runtime, and the panel's behaviour lives in its
// effects: it reads the calendar, it reads the notes, it draws what came back.
// Testing the panel therefore means letting those effects run, which needs a
// document to mount into. What react-dom actually touches is a small surface —
// element creation and insertion, attributes, events, and text nodes — so this
// supplies that rather than a browser.
//
// It is deliberately not a general DOM. It grows only when a render needs it, and
// anything it cannot do should shout rather than quietly return `undefined`.
class ClassList {
  constructor(element) { this.element = element }
  add(...names) { this.element._classes = new Set([...this.element._classes, ...names]) }
  remove(...names) { for (const name of names) this.element._classes.delete(name) }
  contains(name) { return this.element._classes.has(name) }
}

class TextNode {
  constructor(text) { this.nodeType = 3; this.nodeValue = String(text); this.parentNode = null }
  get textContent() { return this.nodeValue }
  set textContent(value) { this.nodeValue = String(value) }
}

class Element {
  constructor(tagName) {
    this.nodeType = 1
    this.tagName = String(tagName).toUpperCase()
    this.localName = String(tagName).toLowerCase()
    this.namespaceURI = 'http://www.w3.org/1999/xhtml'
    this.childNodes = []
    this.parentNode = null
    this.attributes = new Map()
    this.style = {}
    this._classes = new Set()
    this._listeners = new Map()
    this.classList = new ClassList(this)
    this.ownerDocument = null
  }

  get children() { return this.childNodes.filter(node => node.nodeType === 1) }
  get firstChild() { return this.childNodes[0] ?? null }
  get nextSibling() {
    if (!this.parentNode) return null
    const siblings = this.parentNode.childNodes
    return siblings[siblings.indexOf(this) + 1] ?? null
  }

  /**
   * The value of a form control.
   *
   * React's change handling compares the value it last saw with the one on the
   * node, so a test that types has to leave the new text on the element and then
   * let the event deliver it.
   */
  get value() { return this._value ?? '' }
  set value(next) { this._value = String(next) }
  get checked() { return this._checked ?? false }
  set checked(next) { this._checked = Boolean(next) }
  get selectionStart() { return this.value.length }
  set selectionStart(_value) {}
  get selectionEnd() { return this.value.length }
  set selectionEnd(_value) {}
  focus() { this.ownerDocument.activeElement = this }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body }
  setSelectionRange() {}

  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node)
    node.parentNode = this
    this.childNodes.push(node)
    return node
  }

  insertBefore(node, before) {
    if (node.parentNode) node.parentNode.removeChild(node)
    node.parentNode = this
    const at = before ? this.childNodes.indexOf(before) : -1
    if (at < 0) this.childNodes.push(node)
    else this.childNodes.splice(at, 0, node)
    return node
  }

  removeChild(node) {
    const at = this.childNodes.indexOf(node)
    if (at >= 0) this.childNodes.splice(at, 1)
    node.parentNode = null
    return node
  }

  remove() { this.parentNode?.removeChild(this) }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    if (name === 'class') this._classes = new Set(String(value).split(/\s+/).filter(Boolean))
    if (name === 'style') Object.assign(this.style, parseStyle(String(value)))
    // The panel switches views with `data-view`; a test reads it back as an attribute.
    if (name.startsWith('data-')) this[name] = String(value)
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
  removeAttribute(name) { this.attributes.delete(name) }
  hasAttribute(name) { return this.attributes.has(name) }

  addEventListener(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set())
    this._listeners.get(type).add(listener)
  }
  removeEventListener(type, listener) { this._listeners.get(type)?.delete(listener) }

  /**
   * Dispatch one event, bubbling to the ancestors the way a real document does.
   *
   * React attaches a single listener per event type on the root container and
   * works out which component was hit from the event's propagation path, so a
   * click that does not travel from its target up through the container never
   * reaches a react handler.
   */
  dispatchEvent(event) {
    const payload = {
      type: event?.type ?? 'click',
      bubbles: event?.bubbles ?? true,
      cancelable: true,
      defaultPrevented: false,
      target: this,
      currentTarget: this,
      preventDefault() { this.defaultPrevented = true },
      stopPropagation() { this._stopped = true },
      ...event,
    }
    const path = []
    for (let node = this; node; node = node.parentNode) path.push(node)
    payload.eventPhase = 1
    // Capture, then bubble: react reads the whole path off the event.
    for (const node of [...path].reverse()) {
      payload.currentTarget = node
      for (const listener of node._listeners?.get(payload.type) ?? []) {
        if (payload._stopped) return !payload.defaultPrevented
        listener(payload)
      }
    }
    payload.eventPhase = 3
    payload.target = this
    payload.currentTarget = this
    for (const node of path) {
      payload.currentTarget = node
      for (const listener of node._listeners?.get(payload.type) ?? []) {
        listener(payload)
        if (payload._stopped) return !payload.defaultPrevented
      }
    }
    return !payload.defaultPrevented
  }
  click() { this.dispatchEvent({ type: 'click' }) }

  get textContent() {
    return this.childNodes.map(node => node.textContent).join('')
  }
  set textContent(value) {
    for (const node of this.childNodes) node.parentNode = null
    this.childNodes = []
    if (value !== '' && value != null) this.appendChild(new TextNode(value))
  }

  /** @returns the mounted subtree as text, with each element's tag inline. */
  textOf() { return this.textContent }

  /** Every element in this subtree, this one included. */
  descendants() {
    const list = [this]
    for (const node of this.childNodes) if (node.nodeType === 1) list.push(...node.descendants())
    return list
  }

  /** Elements carrying one attribute value, so a test can find what it rendered. */
  queryAll(predicate) { return this.descendants().filter(predicate) }
}

// React decides whether a node takes typed input, and how, from `instanceof`
// checks against these classes, so `createElement` has to hand back the class the
// tag calls for rather than always the base element.
class HTMLInputElement extends Element {}
class HTMLTextAreaElement extends Element {}
class HTMLSelectElement extends Element {}
class HTMLButtonElement extends Element {}
class HTMLIFrameElement extends Element {}
class HTMLAnchorElement extends Element {}
class HTMLImageElement extends Element {}
class HTMLFormElement extends Element {}
class HTMLOptionElement extends Element {}
class HTMLScriptElement extends Element {}
class HTMLStyleElement extends Element {}
class HTMLDivElement extends Element {}
class HTMLSpanElement extends Element {}
class HTMLParagraphElement extends Element {}
class HTMLHeadingElement extends Element {}
class HTMLBRElement extends Element {}
class HTMLHRElement extends Element {}
class HTMLUListElement extends Element {}
class HTMLLIElement extends Element {}
class HTMLLabelElement extends Element {}
class HTMLTableElement extends Element {}
class HTMLTableSectionElement extends Element {}
class HTMLTableRowElement extends Element {}
class HTMLTableCellElement extends Element {}
class HTMLTemplateElement extends Element {}
class HTMLSlotElement extends Element {}

const PER_TAG = {
  input: HTMLInputElement,
  textarea: HTMLTextAreaElement,
  select: HTMLSelectElement,
  option: HTMLOptionElement,
  button: HTMLButtonElement,
  iframe: HTMLIFrameElement,
  a: HTMLAnchorElement,
  img: HTMLImageElement,
  form: HTMLFormElement,
  script: HTMLScriptElement,
  style: HTMLStyleElement,
  div: HTMLDivElement,
  span: HTMLSpanElement,
  p: HTMLParagraphElement,
  h1: HTMLHeadingElement,
  h2: HTMLHeadingElement,
  h3: HTMLHeadingElement,
  h4: HTMLHeadingElement,
  h5: HTMLHeadingElement,
  h6: HTMLHeadingElement,
  br: HTMLBRElement,
  hr: HTMLHRElement,
  ul: HTMLUListElement,
  li: HTMLLIElement,
  label: HTMLLabelElement,
  table: HTMLTableElement,
  thead: HTMLTableSectionElement,
  tbody: HTMLTableSectionElement,
  tfoot: HTMLTableSectionElement,
  tr: HTMLTableRowElement,
  td: HTMLTableCellElement,
  th: HTMLTableCellElement,
  template: HTMLTemplateElement,
  slot: HTMLSlotElement,
}

/** @returns the element class a tag name calls for. */
function classFor(tagName) {
  return PER_TAG[String(tagName).toLowerCase()] ?? Element
}

// React reads a form control's value through an accessor it finds on
// `node.constructor.prototype`. `value` is defined once on the base element, so
// each concrete class gets its own copy of that accessor; without it React cannot
// install its value tracker and never reports a keystroke as a change.
for (const ElementClass of new Set(Object.values(PER_TAG))) {
  if (ElementClass === Element) continue
  for (const field of ['value', 'checked']) {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, field)
      ?? { configurable: true, get() { return this[`_${field}`] ?? (field === 'checked' ? false : '') }, set(next) { this[`_${field}`] = field === 'checked' ? Boolean(next) : String(next) } }
    if (!Object.getOwnPropertyDescriptor(ElementClass.prototype, field)) {
      Object.defineProperty(ElementClass.prototype, field, descriptor)
    }
  }
}

function parseStyle(text) {
  return Object.fromEntries(text.split(';').map(part => part.split(':').map(piece => piece.trim()))
    .filter(([key, value]) => key && value)
    .map(([key, value]) => [key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]))
}

function createDocument() {
  const document = {
    nodeType: 9,
    activeElement: null,
    createElement: (tagName) => {
      const element = new (classFor(tagName))(tagName)
      element.ownerDocument = document
      return element
    },
    createElementNS: (_namespace, tagName) => document.createElement(tagName),
    createTextNode: (text) => new TextNode(text),
    createComment: (text) => ({ nodeType: 8, nodeValue: String(text), parentNode: null, textContent: '' }),
    createDocumentFragment: () => {
      const fragment = new Element('#fragment')
      fragment.ownerDocument = document
      return fragment
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    head: null,
    body: null,
    documentElement: null,
  }
  document.documentElement = document.createElement('html')
  document.head = document.createElement('head')
  document.body = document.createElement('body')
  document.documentElement.appendChild(document.head)
  document.documentElement.appendChild(document.body)
  document.activeElement = document.body
  return document
}

/** Install the minimal document on `globalThis`, returning the mount container. */
export function installDom() {
  const document = createDocument()
  const container = document.createElement('div')
  document.body.appendChild(container)

  globalThis.document = document
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1, COMMENT_NODE: 8, DOCUMENT_NODE: 9, DOCUMENT_FRAGMENT_NODE: 11 }
  globalThis.HTMLElement = Element
  globalThis.Element = Element
  globalThis.Text = TextNode
  // react-dom walks up from the focused element looking for frames, so both the
  // class it tests against and the focus the document reports have to exist.
  globalThis.HTMLIFrameElement = HTMLIFrameElement
  globalThis.HTMLInputElement = HTMLInputElement
  globalThis.HTMLTextAreaElement = HTMLTextAreaElement
  globalThis.HTMLButtonElement = HTMLButtonElement
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const window = {
    document,
    navigator: { userAgent: 'node' },
    HTMLIFrameElement,
    HTMLInputElement,
    HTMLTextAreaElement,
    HTMLButtonElement,
    HTMLElement: Element,
    Element,
    Node: globalThis.Node,
    addEventListener: () => {},
    removeEventListener: () => {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    setTimeout: globalThis.setTimeout?.bind(globalThis),
    clearTimeout: globalThis.clearTimeout?.bind(globalThis),
    requestAnimationFrame: (callback) => globalThis.setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id) => globalThis.clearTimeout(id),
  }
  globalThis.window = window
  // Node defines `navigator` as a getter-only global, so it is replaced by
  // definition rather than assignment.
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true })
  return { document, container, window }
}
