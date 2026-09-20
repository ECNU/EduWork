import { eduworkMarkPath } from './eduwork-mark.js'
export const DEFAULT_PRODUCT_NAME = 'EduWork'

// Assembly supplies its own assets. A public product has no institution logo
// or endpoint baked into the client. Never treat the display name as a key.
export function productIdentity(snapshot) {
  const product = snapshot?.base?.product ?? {}
  const name = typeof product.name === 'string' && product.name.trim() ? product.name.trim() : DEFAULT_PRODUCT_NAME
  const candidate = typeof product.logoUrl === 'string' ? product.logoUrl.trim() : ''
  const logoUrl = /^(?:https?:\/\/|\/(?!\/)|data:image\/(?:svg\+xml|png|webp|jpeg)(?:;|,))/i.test(candidate) ? candidate : ''
  const label = (key, fallback) => typeof product.styleLabels?.[key] === 'string' && product.styleLabels[key].trim() ? product.styleLabels[key].trim() : fallback
  return { name, logoUrl, styleLabels: { dsh: label('dsh', '蓝色'), 'ecnu-liwa': label('ecnu-liwa', '红色') } }
}

export function genericMarkSVG(color) {
  const accent = /^#[\da-f]{6}$/i.test(color) ? color : '#9f2636'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="${accent}"/><path d="${eduworkMarkPath}" transform="translate(43 32) scale(.665 .78)" fill="#fff"/></svg>`
}
