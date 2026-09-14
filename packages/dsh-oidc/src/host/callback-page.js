import { randomBytes } from 'node:crypto'

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

export function callbackLanguage(header = '') {
  const languages = String(header).split(',').map((entry, order) => {
    const [name, quality] = entry.trim().split(';q=')
    return { name: name.toLowerCase(), quality: quality === undefined ? 1 : Number(quality), order }
  }).filter(value => value.quality > 0).sort((a, b) => b.quality - a.quality || a.order - b.order)
  return languages.find(value => /^(zh|en)(-|$)/.test(value.name))?.name.startsWith('zh') ? 'zh-CN' : 'en'
}

/** Only trusted profile presentation and a fixed outcome enter the page. */
export function callbackPage(profile = {}, outcome = 'failed', language = 'en') {
  const zh = language === 'zh-CN'
  const brand = profile.brand ?? {}, product = brand.productName || profile.displayName || 'EduWork'
  const organization = brand.organizationName || profile.organization || ''
  const success = outcome === 'completed' || outcome === 'credential-required'
  const title = success ? (zh ? '身份认证已完成' : 'You’re signed in')
    : outcome === 'expired' ? (zh ? '此次登录已过期' : 'This sign-in has expired') : (zh ? '此次登录未完成' : 'Sign-in did not complete')
  const description = outcome === 'credential-required'
    ? (zh ? '请返回应用，继续完成模型服务连接。' : 'Return to the app to finish connecting your model service.')
    : success ? (zh ? '请返回应用继续工作。' : 'Return to the app to continue your work.')
      : (zh ? '请返回应用重新发起登录。' : 'Return to the app and start sign-in again.')
  const accent = /^#[a-f0-9]{6}$/i.test(brand.primaryColor ?? '') ? brand.primaryColor : '#4f5fd7'
  let logo = '', imageSource = "'none'"
  if (/^data:image\/(png|webp);base64,[A-Za-z0-9+/]+=*$/.test(brand.logoURL ?? '')) { logo = brand.logoURL; imageSource = 'data:' }
  else {
    try { const url = new URL(brand.logoURL); if (url.protocol === 'https:' && !url.username && !url.password && !url.hash) { logo = url.toString(); imageSource = url.origin } } catch {}
  }
  const nonce = randomBytes(18).toString('base64')
  const mark = logo ? `<img src="${escape(logo)}" alt="" referrerpolicy="no-referrer">` : escape(brand.mark || product.slice(0, 1))
  return {
    headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; img-src ${imageSource}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      'x-content-type-options': 'nosniff', connection: 'close',
    },
    html: `<!doctype html><html lang="${language === 'zh-CN' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · ${escape(product)}</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f5f6f8;color:#20232c;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}.card{width:min(100%,480px);padding:36px;border:1px solid #e1e4eb;border-radius:20px;background:#fff;box-shadow:0 14px 48px #17264d0a}.brand{display:flex;align-items:center;gap:12px;margin-bottom:36px}.mark{width:42px;height:42px;display:grid;place-items:center;flex:none;border-radius:11px;background:${accent};color:white;font-size:22px;font-weight:700}.mark img{width:100%;height:100%;object-fit:contain;border-radius:inherit}.name{font-weight:650;font-size:16px}.organization{font-size:12px;color:#747987;margin-top:3px}.status{font-size:12px;color:${success ? '#397958' : '#a14d3b'};margin-bottom:12px}h1{margin:0 0 14px;font-size:26px;line-height:1.35;letter-spacing:-.4px}p{margin:0;color:#5c6270;font-size:15px;line-height:1.8}.hint{margin-top:28px;padding-top:20px;border-top:1px solid #edf0f4;font-size:13px;color:#818694}@media(max-width:480px){.card{padding:28px}h1{font-size:23px}}</style></head><body><main class="card"><div class="brand"><div class="mark">${mark}</div><div><div class="name">${escape(product)}</div>${organization && organization !== product ? `<div class="organization">${escape(organization)}</div>` : ''}</div></div><div class="status">${success ? (zh ? '已验证身份' : 'Identity verified') : (zh ? '需要重新登录' : 'Please try again')}</div><h1>${title}</h1><p>${description}</p><p class="hint">${zh ? '现在可以关闭此标签页。' : 'You can close this browser tab now.'}</p></main></body></html>`,
  }
}
