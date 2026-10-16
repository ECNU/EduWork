// The UI primitives, replaced for a headless render.
//
// The panel is built from the product's own primitives package, which needs the
// desktop shell around it. Rendering the panel without that shell means supplying
// the same surface with plain elements: the panel's own logic — which service it
// calls, with what arguments, and what it draws once the answer arrives — is what
// a test can check, and that logic must not be rewritten to be testable.
import React from 'react'

const passthrough = (tag) => ({ children, ...rest }) =>
  React.createElement(tag, { ...rest, 'data-primitive': tag }, children)

export const Button = ({ children, onClick, disabled, icon, ...rest }) =>
  React.createElement('button', { type: 'button', onClick, disabled, ...rest }, icon ?? null, children)
export const Input = (props) => React.createElement('input', { ...props, 'data-primitive': 'Input' })
export const Tag = ({ children, ...rest }) => React.createElement('span', { ...rest, 'data-primitive': 'Tag' }, children)
export const Tooltip = ({ children }) => React.createElement(React.Fragment, null, children)
export const Toast = ({ children }) => React.createElement('div', { 'data-primitive': 'Toast' }, children ?? null)
export const Switch = ({ label, checked, onChange }) =>
  React.createElement('input', { type: 'checkbox', checked, onChange: (event) => onChange?.(event.target.checked), 'aria-label': label })
export const Menu = passthrough('div')
export const Modal = ({ open, title, description, children, footer, onClose }) =>
  open ? React.createElement('div', { 'data-primitive': 'Modal', 'data-title': title ?? '', 'data-description': description ?? '' },
    children, React.createElement('div', { 'data-primitive': 'ModalFooter' }, footer ?? null)) : null
export const writeClipboard = async () => undefined

export default {
  Button, Input, Tag, Tooltip, Toast, Switch, Menu, Modal, writeClipboard,
}
