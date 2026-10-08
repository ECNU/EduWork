import { normalizeVisualStyle } from '../theme.js'
import { genericMarkSVG, productDocumentTitle, productIdentity } from '../identity.js'

export function installProductIdentity(scope, doc = document, Observer = MutationObserver) {
  const previousTitle = doc.title
  const icon = doc.createElement('link')
  icon.rel = 'icon'
  icon.type = 'image/svg+xml'
  icon.dataset.eduworkProductIcon = 'true'
  doc.head.append(icon)
  let appliedTitle, previousName
  const updateTitle = name => {
    const next = productDocumentTitle(doc.title, name, previousName)
    previousName = name
    if (doc.title !== next) {
      appliedTitle = next
      doc.title = next
    }
  }
  const adopt = () => {
    const snapshot = scope.getSnapshot()
    const identity = productIdentity(snapshot)
    updateTitle(identity.name)
    const color = normalizeVisualStyle(snapshot.value?.visualStyle) === 'ecnu-liwa' ? '#9f2636' : '#2575ff'
    icon.href = identity.logoUrl || `data:image/svg+xml,${encodeURIComponent(genericMarkSVG(color))}`
    if (identity.logoUrl) icon.removeAttribute('type')
    else icon.type = 'image/svg+xml'
  }
  adopt()
  const unsubscribe = scope.subscribe(adopt)
  const observer = new Observer(() => updateTitle(productIdentity(scope.getSnapshot()).name))
  observer.observe(doc.head, { childList: true, subtree: true, characterData: true })
  return () => {
    observer.disconnect()
    unsubscribe()
    if (doc.title === appliedTitle) doc.title = previousTitle
    icon.remove()
  }
}
