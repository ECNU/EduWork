# Lean LSP/MCP Adapter Recipe

Use this reference only when the user explicitly asks to connect Lean LSP/MCP,
Lean MCP, richer goal-state tooling, MCP-backed theorem search, or an optional
Lean-specialist backend that depends on MCP. The default coding-agent Lean path
does not require MCP.

Support status: `adapter_recipe`.

This file documents the boundary required before a coding agent may configure or
call a Lean LSP/MCP server. It does not make MCP a default dependency.

## Upstream Source

Recommended public source:

- `project-numina/lean-lsp-mcp`: https://github.com/project-numina/lean-lsp-mcp

Source note: last checked 2026-07-01 against the public README. `uvx lean-lsp-mcp` is unpinned; record the resolved version or audited commit in setup evidence.

The public README describes a Lean theorem prover MCP server that talks to Lean
through the Language Server Protocol. It exposes diagnostics, goal states, hover
information, declaration lookup, completions, Lean snippet execution, multiple
attempt screening, local project search, external theorem search, and project
build tools. The README also documents VS Code, Cursor, and Claude Code setup,
including `uvx lean-lsp-mcp`, `LEAN_PROJECT_PATH`, optional search URLs, and
security risks.

## When To Use

Use this adapter when the user asks for one of:

- "connect Lean MCP";
- "use Lean LSP/MCP";
- "show the current Lean goal through MCP";
- "use MCP theorem search";
- "run multiple proof attempts with MCP";
- "configure Claude Code / VS Code / Cursor MCP for this Lean project";
- "use Numina-style MCP tooling without a full Numina run".

Do not use this adapter just because a Lean proof is difficult. Try the default
distilled coding-agent loop first unless the user explicitly asks for MCP.

## Setup Contract

Before configuring MCP, state these facts and ask for approval:

- The target must be a buildable Lake project. Run `lake build` manually first
  when feasible so the LSP server starts faster and avoids timeout failures.
- The MCP server may access local files and run local Lean/build operations.
- Default transport: `stdio` only.
- `lean_run_code` is default-deny; expose it only inside a disposable trusted
  sandbox after explicit user approval.
- External theorem search is local-only unless the user approves the remote service and data disclosure.
- External theorem-search tools may call remote services unless disabled,
  replaced with self-hosted endpoints, or approved for the specific project.
- Any project-scoped MCP config, such as `.mcp.json`, is a source-controlled
  file unless the user chooses a local/global scope.
- Review any existing project-scoped `.mcp.json` before enabling it.
- Allowlist direct `uvx lean-lsp-mcp` invocation or an audited pinned command;
  reject shell wrappers, unexpected environment variables, and committed
  secrets.
- Secrets such as bearer tokens must not be committed.

## Readiness Checks

Run or ask the user/host to confirm:

```bash
uvx --version
lake build
rg --version
```

`rg` is optional but recommended for local search. If the project is large, use
`lake build` rather than relying on the MCP server to trigger the first build.

When a project path cannot be detected automatically, set:

```bash
export LEAN_PROJECT_PATH="/absolute/path/to/lake/project"
```

Set `LEAN_PROJECT_PATH` in every MCP client configuration.

## MCP Client Configuration

Use the upstream documented command shape and choose the user's actual client.
Do not write config until the user approves the scope.

### Claude Code

Run from the Lean project root:

```bash
export LEAN_PROJECT_PATH="$PWD"
claude mcp add lean-lsp uvx lean-lsp-mcp
```

For project-scoped config:

```bash
export LEAN_PROJECT_PATH="$PWD"
claude mcp add lean-lsp -s project uvx lean-lsp-mcp
```

Project-scoped config may create or update `.mcp.json`; review it before
committing.

### VS Code

Use the MCP add-server workflow or equivalent `mcp.json` entry:

```json
{
  "servers": {
    "lean-lsp": {
      "type": "stdio",
      "command": "uvx",
      "args": ["lean-lsp-mcp"],
      "env": {
        "LEAN_PROJECT_PATH": "/absolute/path/to/lake/project",
        "LEAN_LOG_LEVEL": "NONE"
      }
    }
  }
}
```

On Windows with WSL2, run the server inside WSL when the Lean project and
toolchain live there:

```json
{
  "servers": {
    "lean-lsp": {
      "type": "stdio",
      "command": "wsl.exe",
      "args": ["env", "LEAN_PROJECT_PATH=/absolute/path/to/lake/project", "uvx", "lean-lsp-mcp"]
    }
  }
}
```

### Cursor

Use Cursor MCP settings with:

```json
{
  "mcpServers": {
    "lean-lsp": {
      "command": "uvx",
      "args": ["lean-lsp-mcp"],
      "env": {
        "LEAN_PROJECT_PATH": "/absolute/path/to/lake/project",
        "LEAN_LOG_LEVEL": "NONE"
      }
    }
  }
}
```

Do not expose HTTP/SSE on `0.0.0.0` or a public interface. HTTP/SSE requires explicit approval, `127.0.0.1`, and a bearer token. Prefer local project config for private work and global config only when the user accepts the broader scope.

## Tool Use Policy

Prefer MCP tools in this order:

1. `lean_diagnostic_messages` to read current errors and warnings.
2. `lean_goal` or `lean_term_goal` to inspect the exact proof state.
3. `lean_hover_info`, `lean_declaration_file`, and `lean_completions` for
   local symbol understanding.
4. `lean_local_search` before external theorem search.
5. `lean_leansearch`, `lean_loogle`, `lean_leanfinder`, `lean_state_search`, or
   `lean_hammer_premise` only when the query is specific and the user has
   approved the remote service, network use, and data disclosure for the
   current project.
6. `lean_multi_attempt` for bounded screening of a few candidate tactics.
7. `lean_build` only after edits or when the LSP state needs a rebuild.

Do not call `lean_run_code` in the default adapter path. If a user explicitly
approves it, run only in a trusted disposable sandbox and still treat the result
as untrusted until local Lean/Lake validation passes.

Never accept an MCP result as final proof. The final gate remains local
Lean/Lake validation plus patch review.

## Failure Triage

Common failures and responses:

- `lake build` is slow or times out: build manually first, then restart MCP.
- Project root not found: set `LEAN_PROJECT_PATH` to the Lake project root.
- Toolchain mismatch: inspect `lean-toolchain` and the active `elan` toolchain;
  do not change project versions without approval.
- MCP server cannot access files: check client working directory and config
  scope.
- External search is rate-limited, unavailable, or not approved: fall back to local `rg`,
  `lean_local_search`, nearby proofs, and mathlib names.
- Security concern: use stdio by default, keep HTTP/SSE on `127.0.0.1` only
  with an explicit bearer token when approved, and do not expose bearer tokens.

## Validation Gate

After any MCP-assisted change:

```bash
lake env lean path/to/file.lean
lake build
PYTHONDONTWRITEBYTECODE=1 python skills/lean-runtime/scripts/ai4m_lean.py review --before <before.lean> --after <after.lean>
PYTHONDONTWRITEBYTECODE=1 python skills/lean-runtime/scripts/ai4m_lean.py detect-sorry --file path/to/file.lean
```

Use the helper paths relative to this repository when validating this skill
package; use the target project's own Lake root for user projects.

Reject output with `sorry`, `admit`, new `axiom`, unapproved theorem statement
drift, unreviewed generated files, or unvalidated backend edits.
