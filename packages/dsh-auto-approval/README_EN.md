# Auto-Approval Plugin

[简体中文](README.md) | **English**

Under a dedicated permission preset, `@eduwork/dsh-auto-approval` reviews requests from commands (bash/pwsh) and file tools (write/edit/apply_patch) to leave the sandbox. When both its fixed rules and a SystemOne-compatible decision model conclude that the user would agree, the request is allowed once; every other request reaches the confirmation card unchanged and the user decides. The plugin never rejects a request on the user's behalf.

The plugin uses DSH's native approval, tool and configuration mechanisms, with no runtime patches. The service address, model and authentication are supplied by the user or the distribution; the package contains no default organization or public inference endpoint.

## How requests are reviewed

A review happens only when all of these hold: the session uses the preset named in the plugin configuration (`auto-approval` by default); the request comes from `bash`, `pwsh` or the file tools `write`, `edit` and `apply_patch`; the call carries `sandbox_permissions`, asking to leave the current sandbox; and no other tool policy (such as hooks) asked to confirm the call with the user. Approvals for other tools such as MCP, calls another policy asks the user about, and sessions under other presets are not affected.

The plugin turns the request into a state for the decision model, with these fields in order: system, workspace (where the sandbox allows writes: the directory the session started in), current directory (where the command actually runs), files created in this session, the assistant message the user replied to, the user's recent messages, the stated justification, earlier commands, risk flag and the pending command. When a bash command just runs one local script file (such as `bash scripts/deploy.sh prod`, `python3 tools/sync.py` or `./run.sh --all`), the script content is added.

A file tool's request goes into the pending command in a form with the same effect: `write` as a `cat > path <<'EOF'` heredoc, `edit` as a patch and `apply_patch` as written, keeping up to 4000 characters of content per section. A last field, target files, lists the real path of each file the call changes (after links), whether it is created, replaced whole, edited, deleted or moved, and whether this session created it.

An answer the user gives on one of the agent's question cards counts as a user message (such as “选择“删除””, chose “delete”), and the assistant message it replied to is that card, whether the answer came while the card waited or after it timed out.

Fixed rules flag operations that the user must have asked for: pushing and publishing, remote connections, uploads, running deployment or release scripts, keychains and credentials, sudo and privilege escalation, installation, changing software configuration (including login items in `~/Library/LaunchAgents`), and system settings. The rules also check the content of the script the command runs. File tools are judged by the same rules on each file's real path, as if `cat >`, `rm` or `mv` ran on it: writing a shell start-up file or under `~/.config` counts as changing software configuration, and deleting a file under `~/.ssh` as touching credentials.

- With a rule hit, the model answers one question, whether the user explicitly asked for this; the request is allowed when that probability is at least 0.7.
- Without a rule hit, two questions are asked in parallel, whether the user would agree and how serious a mistake would be; the request is allowed when their mean (the probability of agreement averaged with 1 − severity) is at least 0.5.
- When a file tool changes a file that was there before this session, the score is the lower of that mean and the probability of agreement: the change is allowed only when the user asked for it and it is easy to undo. However small, a change the model judges unrequested goes to the user.

An approval covers this one request only and is not remembered. After the user rejects an escalation on the confirmation card, the session's escalations are not reviewed and go straight to the user until the user writes again.

## Installation and configuration

Install `@eduwork/dsh-auto-approval` from DSH plugin management. The native bundle uses the fixed ID `auto-approval` with `enabled: false` by default.

A plugin cannot add permission presets, so add a preset with sandbox `workspace-write` and approval `ask` to the configuration of the DSH permission plugin (ID `permission`). This configuration replaces the whole preset table, so list the existing presets as well:

```json
{
  "presets": {
    "read-only": { "sandbox": "read-only", "approval": "ask" },
    "workspace-write": { "sandbox": "workspace-write", "approval": "ask" },
    "auto-approval": {
      "sandbox": "workspace-write",
      "approval": "ask",
      "name": "Auto-approval",
      "description": "Operations outside the workspace are reviewed by the decision model first; you are asked when it is unsure"
    },
    "danger-full-access": { "sandbox": "danger-full-access", "approval": "never" }
  }
}
```

Plugin configuration example (store the real key in the credential service; do not put the key in this configuration):

```json
{
  "enabled": true,
  "preset": "auto-approval",
  "baseURL": "https://decision.example.org/v1",
  "model": "your-decision-model",
  "authMode": "api-key",
  "credentialRef": "SYSTEMONE_API_KEY",
  "timeoutMs": 5000
}
```

`baseURL` includes the API prefix; requests use the client of [`@eduwork/dsh-decision`](../dsh-decision/README_EN.md). For organization sign-in, choose `authMode: "oidc"` and set `oidcProfileId`, which requires a compatible `@eduwork/dsh-oidc`. Choose `authMode: "none"` only for services that are explicitly unauthenticated.

## Failures and timeouts

- One review has a total time limit of `timeoutMs` (5 seconds by default); on expiry the user decides.
- Network errors, 429 and 5xx are retried once within the limit; the questions have no side effects.
- After 3 failures in a row in one session, review pauses for 5 minutes there and requests go straight to the user.
- Not being signed in, a missing key, an incomplete answer or an abstention (`choice: null`) counts as a failure, with no fallback to another model or authentication method.
- A request withdrawn by the user during review is not counted as a failure.

## Seeing review results

Each request reviewed under the preset leaves a notice in the session along with the call's result, saying whether automatic approval allowed the escalation or handed it to the user. The trajectory shows it as a context row; opening it shows the outcome and score under its source, such as “已自动放行（分数 0.952）” (allowed automatically, score 0.952) or “交给用户确认（命中规则，分数 0.600）” (asked the user, rule hit, score 0.600). A request without a review result gives the reason: the review timed out, failed, was paused after failures in a row, the command was too long to review, the user had rejected an escalation, or the situation changed during the review. The notice is written in Chinese, like the review questions.

The notice also reaches the conversation model in its next step. Like DSH's own runtime context it is wrapped in `<system-reminder>` and says it is not from the user, so the agent neither describes an automatic approval as the user's nor takes the notice for something the user said; the score is not sent, so the agent cannot tune its justifications to it. DSH's conversation view does not show injected context like this, so the notice is visible only in the trajectory.

Each review is also logged under the `auto-approval` logger with its result, score and duration; failures are logged as warnings with their cause.

## What is sent to the decision service

The state includes the user's last 3 messages (first 300 characters each), the assistant message the user replied to (last 1000 characters), the 6 earlier commands (first 300 characters each), the paths of the last 8 files `write` created in this session, the script the command runs (up to 16000 characters), and the content a file tool writes (up to 4000 characters per section) with the paths of the files it changes. Before enabling the plugin, make sure the decision service may receive this content.

## Evaluation and limits

The rules and questions were evaluated on 6 sets with 419 real escalation requests in total, each set labeled "should allow" or "should ask" before it was run: 284 (68%) were allowed automatically, and none of the 134 requests that should have been asked was allowed. The evaluation used one SystemOne-compatible decision model; other models need their own evaluation.

File-tool review was evaluated on real writes outside the workspace taken from other coding agents' sessions, prepared as the plugin prepares them and sent to the same decision model: 109 of the 141 that should be allowed (77%) were allowed, and none of the 35 that should be asked was allowed; 3 of those are real requests and 32 were built by giving a change to an existing file the context of another task. The rule that a change to an existing file needs the user's request was added after seeing the first set's results; with it in place, a held-out set drawn afterwards was run once: 25 of the 33 that should be allowed were allowed, and all 15 that should be asked went to the user.

- Subagents: DSH fixes approval in child sessions to `never`, so their escalation requests are rejected before approval; the plugin also skips subagent sessions, whose "user messages" come from the delegating agent.
- "Files created in this session" records only new files that `write` created successfully, compared by real path; an Add File in a patch may replace a file that was there, so like a file a command created it does not count. The list starts empty after a Host restart. Such files are therefore treated as existing files when a file tool changes them.
- The confirmation card is unchanged and does not show the review result.
- DSH 0.2.2 draws icons only for its four built-in permission presets, so the added preset has no icon in the menu.
- Commands over 16000 characters are not reviewed and go straight to the user; the longest command in the evaluation data was about 13000 characters. A file tool's call is measured with its content cut.
- Rules match the command text. Script content is attached only when the whole bash command runs one script by a written path, and files that script calls are not read. Sequences, `cd`, variables (including `NAME=value` before the command), globs, pipes, redirections, `..` in the path, inline code such as `node -e`, bare names (which the shell looks up on PATH) and PowerShell commands do not say for sure which file runs, so no script is attached and the command itself is still reviewed.

## Development and assembly

Sources live in `src/`; the build only copies ESM modules. Node >=24.22.1, verified on DSH 0.2.2-rc.1. Point `EDUWORK_AUTO_APPROVAL_RUNTIME` at the locked Runtime (a directory with package.json/node_modules) and run `npm ci` and `npm run check`. Tests use synthetic material and local HTTP, and run the flow from a model's request to a completed approval on the real Runtime.

Repository entry points are `node scripts/packages/manage.mjs check dsh-auto-approval` and `pack dsh-auto-approval`; see the [package maintenance guide](../../docs/PACKAGES_EN.md). A production product must first publish and verify the npm package, then update its exact lock.
