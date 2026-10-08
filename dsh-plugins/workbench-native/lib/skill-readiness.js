import { accountBindingAvailable } from '@chatecnu-work/dsh-skill-control-native/core'

// Report the same authorization prerequisites used by the skill provider.
// An organization-bound skill must never fall back to a personal API key.
export async function skillReadiness(ctx, { binding, credential, capability }) {
  const unavailable = requirement => ({ available: false, requirement })
  try {
    if (binding) {
      const accounts = ctx.get('oidcAccounts')
      if (!accounts) return unavailable('机构账号服务暂不可用')
      if (!await accountBindingAvailable(accounts, binding))
        return unavailable('请登录或检查机构账号连接')
    } else if (credential && !(await ctx.credentials.describe(credential))?.configured) {
      return unavailable('需要配置相应服务')
    }
    if (capability) {
      const services = ctx.get('artifactServices')
      const providers = capability === 'image-generation' ? await services?.images?.list() : []
      if (!providers?.some(row => row.available === true)) return unavailable('需要配置相应服务')
    }
    return { available: true, requirement: '' }
  } catch {
    return unavailable('暂时无法检查服务，请稍后重试')
  }
}
