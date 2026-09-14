/**
 * Return whether a clipboard event originated from DSH's current composer.
 *
 * DSH 0.1.2 uses a Lexical contenteditable root instead of the textarea used
 * by older releases. Inspect the composed path so paste events dispatched
 * from a paragraph or another Lexical child still resolve to that root.
 */
export function isComposerPasteEvent(event) {
  const path = typeof event?.composedPath === 'function'
    ? event.composedPath()
    : [event?.target]
  return path.some(node => typeof node?.matches === 'function' && node.matches('[data-composer-input]'))
}
