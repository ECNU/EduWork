# External agent connections

[中文](README.md)

An optional EduWork plugin for discovering local Codex, Cursor Agent CLI, OpenCode and Kimi Code, checking and toggling connections in Settings, and adding stdio ACP agents manually. Supports DSH 0.2.1-rc.5 and 0.2.2-rc.1; the companion official Codex/ACP providers must match the Host version.

## Install and use

1. In editions bundling this plugin, open Plugins → EduWork extensions, enable External agents and choose Configure. First-time preinstallation starts disabled, disabling preserves connection settings, and upgrades retain existing selections. For source trials, follow the [build guide](DEVELOPMENT.md) and install the local directory from the Plugins page.
2. The same form is available in Settings → External agents and in the plugin details in standalone DSH. Discovery only checks common directories and PATH; it executes nothing. Paths are candidates: confirm they belong to trusted installations.
3. Log in through the agent itself, check the connection, then explicitly enable it. Main model login is separate; this plugin neither stores nor forwards login credentials.
4. Ask the main chat to delegate, for example “Use subagent_codex to analyze this text.” Tasks, the subagent list and result notifications remain DSH-owned; no separate scheduler or task panel is added.

Codex uses the runtime pinned by the official DSH package and existing local login. The discovered CLI path is informational and does not override that runtime. Disable an existing official Codex bundle before enabling this connection to avoid duplicate provider registration. Cursor requires its Agent CLI; the editor alone is insufficient.

For other ACP agents, enter a name, an absolute executable path and a JSON argument array such as `["acp"]`. Saving does not launch it. A check sends only `initialize`, never a session or task. A successful handshake does not verify login or real model execution. Do not put secrets in arguments.

## Discovery and protocols

| Agent | Connection | Entry point reference |
| --- | --- | --- |
| Codex | Official DSH Codex provider with a Host-pinned runtime | Existing official provider |
| Cursor Agent CLI | `agent acp` | [Official ACP documentation](https://cursor.com/docs/cli/acp) |
| OpenCode | `opencode acp`, ACP v1 stdio | [Official protocol reference](https://opencode.ai/docs/cli/acp/) |
| Kimi Code | `kimi acp`, ACP stdio | [Official command and capability matrix](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp) |

ACP connections use the existing provider's [v1 session protocol](https://agentclientprotocol.com/protocol/v1/overview); connection checks verify the protocol version. Discovery confirms executable presence only. Login, tasks and tool capabilities require acceptance with the installed version after enabling. OpenCode also checks `~/.opencode/bin`; Kimi uses the shared `~/.local/bin` and PATH locations. Windows discovery accepts native `.exe` files; `.cmd` and `.ps1` launchers require separate adaptation. Newly discovered connections start disabled.

Other official ACP implementations can be configured manually. The discovery catalog includes official public session entry points; experimental interfaces, third-party adapters and MCP tool endpoints require separate evaluation. The plugin does not download registry programs or run installers.

## Boundaries

- Settings persist through DSH storage domain; enabled connections restore on restart. Check results are not persisted. New connections start disabled and require a successful check before enabling.
- Disabling blocks new tasks; DSH continues to manage existing runs. Disabled manual entries can be removed. Failed restoration does not block other connections or prevent disabling the failed entry.
- Codex uses `permissionMode: never`; ACP uses `permission: reject`. Refusing interactive approval is not a read-only policy or a separate filesystem sandbox. Official providers own workspace and task permission semantics.
- Only discovery, connection checks and configuration UI are new. Official providers, subprocess and tool-subagent own delegation, process teardown, permissions, session isolation and result delivery. Settings use official slots, locale and Typert remotes without widening default access.
- Local desktop Hosts only: no remote discovery, automatic installation/login or task resumption. macOS is the first acceptance platform; Windows/Linux need native acceptance.

See the [build guide](DEVELOPMENT.md) for development and tests.
