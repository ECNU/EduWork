import React, { useEffect, useRef } from 'react'

const eventName = 'eduwork:tray-action'
const handlers = new Map()
export function bindDesktopAction(action, callback) {
  handlers.set(action, callback)
  const drain = () => {
    const pending = window.__eduworkTrayActions ?? []
    window.__eduworkTrayActions = []
    for (const value of pending.slice(-8)) {
      const handler = handlers.get(value)
      if (handler) handler()
      else if (value === 'new-session' || value === 'settings') window.__eduworkTrayActions.push(value)
    }
  }
  window.addEventListener(eventName, drain)
  drain()
  return () => {
    window.removeEventListener(eventName, drain)
    if (handlers.get(action) === callback) handlers.delete(action)
  }
}

/** The official settings shell owns its button/open state. This slot retains
 * that owner and invokes its enclosing button, without querying translated UI. */
export function DesktopSettingsTrigger({ wide }) {
  const anchor = useRef(null)
  useEffect(() => bindDesktopAction('settings', () => {
    anchor.current?.closest('button[aria-haspopup="dialog"]')?.click()
  }), [])
  return React.createElement(React.Fragment, null,
    React.createElement('span', { ref: anchor, 'aria-hidden': true, style: { fontSize: 18, lineHeight: 1 } }, '⚙'),
    wide && React.createElement('span', null, '设置'))
}
