// DSH 0.2.0-rc.2 measures the document scrollport for fit-width rendering.
// Classic scrollbars can alternately appear/disappear at a page-height boundary,
// changing that measured width and triggering another PDF render each frame.
// Reserve their space without replacing the official renderer or zoom controls.
export const documentPreviewLayoutCss = '[data-document-zoom-scrollport] { scrollbar-gutter: stable; }'

export function installDocumentPreviewLayout(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.eduworkDocumentPreviewLayout = ''
    style.textContent = documentPreviewLayoutCss
    document.head.append(style)
    return () => style.remove()
  }, 'document preview: stable scrollbar space')
}
