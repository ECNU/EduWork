import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconEditOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

const h = React.createElement
const ROWS = '[data-chat-flow-kind="steering"] [data-clock]'

const sameRows = (a, b) => a.length === b.length && a.every((row, index) => row === b[index])

/**
 * A message steered into a running Turn cannot be edited on its own: it
 * joined the Turn partway, after work a resend cannot undo. Its row shows the
 * pencil unavailable and points to the message that opened the Turn, which
 * the edit replaces together with it.
 *
 * Chat renders no plugin seat on steering rows, and a seat on the opening
 * row unmounts when it scrolls out of the virtualized list while its steered
 * rows may still show, so one always-mounted overlay finds the rows instead.
 */
export function SteeringPencils({ t }) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    let frame = 0
    const scan = () => {
      frame = 0
      const found = [...document.querySelectorAll(ROWS)]
      setRows(current => (sameRows(current, found) ? current : found))
    }
    const observer = new MutationObserver(() => { frame ||= requestAnimationFrame(scan) })
    observer.observe(document.body, { childList: true, subtree: true })
    scan()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])
  return rows.map((row, index) => createPortal(h('button', {
    type: 'button', className: row.querySelector('button:not([data-eduwork-steering-edit])')?.className, 'data-eduwork-steering-edit': '',
    'aria-label': t('edit'), title: t('steering'), 'aria-disabled': true, 'data-unavailable': true,
  }, h(IconEditOutlineRegular, {})), row, index))
}
