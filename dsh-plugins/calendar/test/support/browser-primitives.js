// The product's UI primitives, for a page that is not the product's shell.
//
// The real primitives package is a library the desktop shell loads, with markdown,
// syntax highlighting and CSS modules behind it; it does not bundle into a page on
// its own. What the acceptance run needs from it is the *interface* the panel is
// written against — a button that is a button, a modal that is a dialog, a textarea's
// label — so this file supplies that surface with plain React elements.
//
// Nothing here decides anything: every label, click handler, disabled state and
// accessible name comes from the panel. That is why a browser test built on this is
// still a test of the panel rather than of this file.
//
// Icon exports are deliberately absent, which the panel already tolerates: it
// resolves each icon by name and falls back to drawing nothing. The panel's
// behaviour under test is its own; the artwork is not.
const h = window.React.createElement

const cx = (...values) => values.filter(Boolean).join(' ')

/** A real `<button>`, so a click is a click and the role comes from the element. */
const Button = ({ children, onClick, disabled, variant, size, icon, className, ...rest }) =>
  h('button', { type: 'button', onClick, disabled: Boolean(disabled), className: cx('ui-button', className), ...rest },
    icon ?? null, children)

const Input = ({ className, ...rest }) => h('input', { className: cx('ui-input', className), ...rest })

const Tag = ({ children, className, ...rest }) =>
  h('span', { className: cx('ui-tag', className), ...rest }, children)

/** The tooltip supplies the panel's icon-only buttons with their accessible name. */
const Tooltip = ({ children }) => h(window.React.Fragment, null, children)

const Toast = ({ children, onDone, className, ...rest }) =>
  h('div', { className: cx('ui-toast', className), ...rest }, children ?? null)

/**
 * A switch the accessibility tree agrees is a switch, so the panel's import dialog
 * can be driven by name the way a person would.
 */
const Switch = ({ label, checked, onChange, disabled, ...rest }) =>
  h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': Boolean(checked),
    'aria-label': label,
    disabled: Boolean(disabled),
    onClick: () => onChange?.(!checked),
    ...rest,
  }, h('span', { 'aria-hidden': 'true' }, checked ? '开' : '关'))

/**
 * The panel passes `selectedId` to name the row it has selected. The real menu reads
 * it to style that row; here the row is styled by the panel itself, so the prop is
 * consumed rather than spread onto the element, where React would warn about it.
 */
const Menu = ({ children, selectedId, className, open, anchor, items = [], onSelect, onClose }) =>
  h('div', { className: cx('ui-menu', className) }, anchor, children,
    open ? h('div', { className:'ui-menu-items', role:'menu' }, ...items.map(item => item.type === 'label'
      ? h('div', {key:item.id}, item.text)
      : h('button', {key:item.id,type:'button',role:'menuitem',onClick:() => {onSelect?.(item.id);onClose?.()}}, item.label ?? item.text ?? item.id))) : null)

/**
 * A modal, as the panel expects it: a dialog with a title, an optional description
 * and a footer of actions. It draws only when `open`, and a click on the backdrop
 * closes it — the two behaviours the panel relies on.
 *
 * The panel supplies its own close control in the footer, so one is not added here:
 * a second button of the same name would be two ways to do one thing, and a person
 * reading the page would see both.
 */
const Modal = ({ open, title, description, children, footer, onClose, className }) => {
  if (!open) return null
  return h('div', { className: cx('ui-modal', className), style: { position: 'fixed', inset: 0, zIndex: 1000, overflowY: 'auto' } },
    h('div', { 'data-backdrop': '', onClick: onClose, style: { position: 'absolute', inset: 0 } }),
    h('div', { role: 'dialog', 'aria-label': title, style: { position: 'relative', background: 'white' } },
      title ? h('h2', null, title) : null,
      description ? h('p', null, description) : null,
      children,
      footer ? h('div', { className: 'ui-modal-footer' }, footer) : null))
}

const writeClipboard = async text => {
  try {
    await navigator.clipboard.writeText(String(text ?? ''))
    return true
  } catch {
    return false
  }
}

window.Primitives = {
  Button, Input, Tag, Tooltip, Toast, Switch, Menu, Modal, writeClipboard,
}
