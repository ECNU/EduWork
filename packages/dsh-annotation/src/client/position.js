export function place(x, y, width, height, viewportWidth, viewportHeight, anchorTop = y) {
  const left = Math.max(8, Math.min(x - width, viewportWidth - width - 8))
  const below = y + 8
  const top = below + height <= viewportHeight - 8 ? below : anchorTop - height - 8
  return { left, top: Math.max(8, Math.min(top, viewportHeight - height - 8)) }
}
