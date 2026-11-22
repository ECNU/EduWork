# Optional Official Numina Backend Adapter

This skill keeps the official `project-numina/numina-lean-agent` repository as a built-in recommended Lean-specialist backend adapter in the adapter-first backend design. The default path is coding-agent Lean work with local Lean/Lake validation; Numina is used when the user asks for the official Lean Agent, Numina, batch proof search, or an approved external subagent run.

Built-in recommended adapter: official Numina Lean Agent runtime.

Numina and Archon are recommended adapter candidates, not defaults or hard requirements. Other Lean-specialist backends may be connected by the coding agent through the backend adapter checklist; do not call any backend until deployment, readiness checks, invocation, validation, and failure triage are documented. See `backend_adapter_checklist.md` before connecting Archon or any other backend.

## Agent Flow

1. Clarify the target: configure the built-in recommended Numina adapter, call Numina on a Lean project/file/folder, validate Numina output, or continue with the default coding-agent path.
2. Run `doctor --cwd .` when useful and read the `numina` readiness block before recommending a path.
3. Explain what setup may do: clone the official repository, run `tutorial/setup.sh`, install or use `elan`, `lake`, `curl`, `uv`, and `claude`, and require model/API credentials or Claude CLI auth for calls.
4. After approval, run `configure --cwd . --setup-numina --project-name <name>`. Use `--dry-run` first when the user wants to review commands.
5. For an official Numina subagent run, call the upstream runner from `${AI4MATH_HOME:-~/.ai4math}/numina-runtime/upstream` using its documented interface, normally `uv run python -m scripts.run_claude from-folder <target> --prompt-file prompts/autosearch/main_entry.md --max-rounds <n> --result-dir <dir>`.
6. After Numina changes Lean files, use local `check`, `detect-sorry`, and `review` before accepting the patch.

Default to the shared Lean workspace for user tasks. Upstream Numina examples or benchmarks may pin their own `lean-toolchain`; that only describes the example project, not the readiness of `${AI4MATH_HOME:-~/.ai4math}/lean-workspace`.

## Local State

- Runtime root: `${AI4MATH_HOME:-~/.ai4math}/numina-runtime/`
- Upstream checkout: `${AI4MATH_HOME:-~/.ai4math}/numina-runtime/upstream/`
- Ignored credential file: `${AI4MATH_HOME:-~/.ai4math}/numina-runtime/.env.local`
- Suggested outputs: `${AI4MATH_HOME:-~/.ai4math}/numina-runtime/results/`

Do not commit runtime state, API keys, generated results, or local machine paths.

## Credentials

Claude authentication can come from the user's normal Claude CLI login or environment variables such as `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, and `ANTHROPIC_MODEL`. Numina's CLI skills may also need `GEMINI_API_KEY`, `OPENAI_API_KEY`, `LEAN_LEANDEX_API_KEY`, or `AXLE_API_KEY`.

If the user asks whether API keys are needed, distinguish the two paths: the default coding-agent Lean workflow and local Lean validation do not need API keys; Numina adapter calls need a working Claude CLI/auth path and may need additional keys for search/tool skills.

The helper readiness report redacts values and only reports whether keys appear configured.

For authentication, proxy, MCP scope, and runner failure triage, use `numina_subagent_troubleshooting.md`.

## Boundary

The AI4Math skill still owns delivery quality. Official Numina may propose or edit proofs, but final acceptance requires local Lean/Lake validation and the usual patch safety checks: no `sorry`, no `admit`, no newly introduced `axiom`, and no theorem statement drift unless explicitly approved.
