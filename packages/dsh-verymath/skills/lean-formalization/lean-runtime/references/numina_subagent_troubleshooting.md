# Numina Subagent Troubleshooting

Use this reference when the optional official Numina subagent path fails during setup, authentication, proxy routing, MCP/tool scope, runner execution, or Lean validation. Keep the default coding-agent Lean path available unless the user specifically requires Numina.

## Checkpoint Format

Report failures as:

```text
[check] <what was checked>
[pass/fail] <result>
[next action] <one concrete command or decision>
```

Do not expose API key values. Only report whether a credential appears configured.

## Authentication Modes

Mode A: Claude CLI or Anthropic-compatible environment.

Required signals:

- `claude` is installed and authenticated, or `ANTHROPIC_AUTH_TOKEN` is configured;
- `ANTHROPIC_BASE_URL` is set when using a non-default endpoint;
- `ANTHROPIC_MODEL` names the intended model.

Mode B: Gemini or another provider through LiteLLM/Anthropic-compatible proxy.

Required signals:

- upstream key such as `GEMINI_API_KEY` is configured;
- LiteLLM or the team gateway is reachable;
- `ANTHROPIC_BASE_URL` points to the proxy;
- `ANTHROPIC_AUTH_TOKEN` is set to the proxy token expected by that gateway;
- a small `/v1/messages` probe succeeds before running Numina.

## Proxy Checks

When `ANTHROPIC_BASE_URL` is not the public Anthropic endpoint:

- check that the base URL is reachable from the same shell that will run Numina;
- verify proxy logs if the request reaches the proxy but model routing fails;
- separate network failure from model-auth failure.

Typical next actions:

- proxy unreachable: start LiteLLM or fix `ANTHROPIC_BASE_URL`;
- `401` or auth error: refresh token/key and rerun readiness;
- model not found: align `ANTHROPIC_MODEL` with the proxy route.

## MCP Scope

If the official runner or Claude CLI tools depend on MCP:

- add/list MCP servers from the target Lean project directory, not from an unrelated folder;
- confirm `claude mcp list` shows the expected server in the same directory context;
- rerun the Numina command from the project root or the documented upstream runner cwd.

If MCP works globally but fails in a project, treat it as a scope/cwd problem first.

## Failure Routing

- `401`, `AuthenticationError`, or invalid token: credentials or proxy auth.
- connection refused, timeout, DNS, or TLS error: proxy/network endpoint.
- `mcp` server missing, disconnected, or wrong cwd: MCP scope.
- `lake` or `lean` failure before Numina starts: target project is not buildable.
- `lean-toolchain` download failure in upstream examples: example project issue, not necessarily shared workspace failure.
- Numina produces Lean with `sorry`, `admit`, new `axiom`, or statement drift: reject output and validate/minimize locally.

## Recovery Order

1. Preserve the user's target file and theorem statement.
2. Verify local Lean workspace or target Lake project.
3. Verify Numina runtime and upstream checkout.
4. Verify Claude/API/proxy/MCP readiness only if Numina will be called.
5. Run the smallest approved Numina command.
6. Validate all changed Lean files locally before returning success.
