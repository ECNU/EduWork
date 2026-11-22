# Backend Adapter Checklist

Use this checklist before connecting any Lean-specialist backend. Backend integration is adapter-first: default coding-agent Lean work must not require any backend adapter, and every backend call must pass through an explicit adapter contract.

## Support Status

- `built_in_recipe`: optional adapter recipe maintained in this repository.
  The agent still needs explicit approval, documented readiness, invocation,
  local validation, and failure triage before use.
- `adapter_recipe`: documented adapter recipe for explicit user-approved
  escalation. Treat it as opt-in, not as a default dependency.
- `candidate`: recommended backend family or related work, but no complete
  adapter recipe is maintained here.
- `unsupported`: related work only; do not call it automatically.

Built-in recommended adapter: official Numina Lean Agent runtime.

Numina and Archon are recommended adapter candidates, not defaults or hard requirements. The official Numina runtime is `built_in_recipe`; Lean LSP/MCP is `adapter_recipe` in `lean_lsp_mcp_adapter.md` for goal-state tooling and MCP-backed theorem search when the user explicitly asks for it. Other Lean-specialist backends may be connected by the coding agent through the backend adapter checklist, but do not call any backend until deployment, readiness checks, invocation, validation, and failure triage are documented.

## Adapter Contract

Document all of the following before calling a backend adapter:

- Name, upstream source, license, and support status.
- Trigger phrases that justify using this backend.
- Setup location, install commands, network access, and local state written.
- Required tools, credentials, API keys, proxy settings, or MCP scope.
- Readiness checks that do not call external model APIs.
- Invocation command, working directory, target project/file/folder, prompt, result directory, and round limits.
- Mutation boundary: which files may be changed, where generated outputs go, and which actions require approval.
- Local validation gate: Lean/Lake check, `detect-sorry`, `review`, and theorem statement drift checks.
- Failure triage: auth, proxy, MCP, toolchain, runner, timeout, and fallback to the coding-agent path.

## Non-Claim Rule

Do not call a backend adapter unless its setup, call, credential, mutation, and validation contracts are documented. Undocumented adapters may be cited as related work or recommended candidates only.
