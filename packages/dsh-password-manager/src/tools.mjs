export function registerPasswordTools(ctx, defineTool) {
  ctx.tools.register(defineTool({
    name: 'password_manager',
    description: 'Log in using a saved browser account: action=login, provider=builtin, url=the HTTPS login URL (no query or fragment). The desktop asks the user to select/authorize an account once per conversation, then fills and submits privately and resumes the sidebar with session cookies. Passwords never appear in tool arguments or results. Do not inspect password fields, network bodies, local vault files or source code. session-ready means session cookies were handed off; verify the signed-in page with ordinary browser tools. login-needs-user means stop automated retries and let the user handle MFA or unsupported forms. Call directly; no browser target IDs are needed.',
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'login'] },
      provider: { type: 'string', enum: ['builtin'] },
      url: { type: 'string', description: 'HTTPS login page for the built-in password manager.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { status: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    timeoutMs: 420000,
    execute: async (args, exec) => {
      if (Object.keys(args).some(key => !['action', 'provider', 'url'].includes(key))) return { status: 'invalid-request' }
      if (!exec.agent || exec.agent.session.header.origin === 'subagent') return { status: 'desktop-session-required' }
      if (typeof ctx.desktopServices?.passwordManager !== 'function') return { status: 'not-supported' }
      if ((args.provider !== undefined && args.provider !== 'builtin') || !['status', 'login'].includes(args.action)) return { status: 'invalid-request' }
      const body = { action: args.action, provider: 'builtin', ...(args.url !== undefined && { url: args.url }),
        ...(args.action === 'login' && { sessionId: exec.agent.session.id }) }
      try {
        const result = await ctx.desktopServices.passwordManager(body, exec.signal)
        // The native bridge may evolve; never serialize arbitrary payloads into
        // model context. Built-in replies are a fixed status vocabulary only.
        return { status: builtinStatuses.has(result?.status) ? result.status : 'operation-failed' }
      }
      catch { return { status: 'operation-failed' } }
    },
  }))
}

const builtinStatuses = new Set(['available', 'agent-login-disabled', 'invalid-request', 'busy', 'vault-unavailable', 'no-saved-account',
  'cancelled', 'unsupported-platform', 'debugging-enabled', 'unsupported-login-page', 'origin-changed',
  'login-needs-user', 'unsafe-session-state', 'login-certificate-error', 'login-connection-failed',
  'login-timeout', 'session-ready', 'operation-failed', 'not-supported'])
