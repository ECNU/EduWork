// Static messages only: never expose provider errors, URLs or credentials.
export function loginLoadStatus(error) {
  const code = error?.code || /^ERR_[A-Z_]+/.exec(error?.message || '')?.[0]
  if (code?.startsWith('ERR_CERT_') || ['ERR_SSL_PROTOCOL_ERROR', 'ERR_SSL_VERSION_OR_CIPHER_MISMATCH'].includes(code)) return 'login-certificate-error'
  if (code === 'ERR_ABORTED') return 'cancelled'
  return 'login-connection-failed'
}

export const loginErrorMessages = Object.freeze({
  'login-certificate-error': '登录页的 HTTPS 证书验证失败。请检查域名、证书有效期及系统信任链；校内证书请联系管理员部署。未填写密码。',
  'login-connection-failed': '无法连接登录页。请检查网址、网络和服务是否启动；HTTPS 服务必须使用 https:// 地址。未填写密码。',
  'unsupported-login-page': '当前页面的登录表单无法安全识别，未填写密码。首版支持同一表单中一个用户名框和一个密码框。',
  'origin-changed': '登录跳转到了授权范围之外的网站，本次登录已停止。跨域统一认证需要专门支持。',
})
