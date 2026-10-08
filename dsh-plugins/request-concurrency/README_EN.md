# Total model-request concurrency

[简体中文](README.md)

Limits official `llm/stream` requests with a FIFO queue. The default is 3 active requests across the Host: all conversations, workspaces, subagents, workflows and auxiliary calls such as compact share the limit. No slot is reserved for the main conversation.

## What is limited

A slot belongs to an active model response stream, not an entire agent task. It is released while a task runs tools or waits, allowing nested work even with a limit of 1. Cancellation removes queued requests; completion and errors release active slots in `finally`.

Settings → General exposes one value (1–64), saved as `eduwork-concurrency.maxConcurrentRequests` in `dsh/settings.yaml` and applied immediately. Lowering the limit lets current requests finish; raising it starts eligible queued requests.

Legacy `maxParallelSubagents: N` is migrated once to total concurrency `N + 1`, atomically saved in settings, and removed. A saved total value takes priority. Configuration defaults are supplied through:

```jsonc
{ "features": { "maxConcurrentRequests": 3 } }
```

Both desktop shells pass the configuration default through `EDUWORK_MAX_CONCURRENT_REQUESTS`. Web can set the plugin's `maxConcurrentRequests`. Legacy `maxParallelSubagents` configuration and `EDUWORK_MAX_PARALLEL_SUBAGENTS` remain compatible. Saved user preferences take priority. File changes require restart; UI saves do not. The user's configuration file is not rewritten during preference migration.

The native DSH 0.1.7 desktop passes `features.maxConcurrentRequests` through generated plugin configuration instead of the legacy environment variable. The official volatile settings API persists UI changes in the desktop profile. On 0.1.7-rc.2, `features.maxActiveSubagents` separately supplies the official `subagent` plugin's default count of 2; reaching that count rejects new subagents. The two limits are independent. Saved UI limits always take priority over subsequent deployment defaults.

The official workflow `maxConcurrentAgents` setting (default 2) limits workflow task count separately. This plugin does not govern direct HTTP/SDK calls in external processes, image generation or TTS. A server must still enforce account-level limits across clients.

## Verification

Run `node --test test/concurrency.test.mjs`. Point `EDUWORK_TEST_RUNTIME` at the pinned rc.2 runtime's `d` directory to exercise real Cordis, DSH LLM and Settings services: limits of 1/2/3, two root sessions plus six subagents, legacy preference migration, live updates, cancellation and nesting. Tests use synthetic adapters without user sessions or external services. `dsh-host/test/product-profile.test.mjs` covers configuration delivery for both shells.
