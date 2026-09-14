# Local activity insights

[简体中文](README.md)

Read-only local statistics built from official DSH Session Query observations: activity days, streaks, actual token usage, models, reasoning, tool calls and skills. No conversation content or statistics are uploaded.

## Data and calculation

Derived summaries live at `$DSH_HOME/derived/activity-insights/v3/`. They contain counts, dates, names, durations, revisions and cursors, without conversation bodies, system prompts, tool arguments/results, paths or workspace names. Older cache schemas can be rebuilt without changing source sessions.

The initial scan reports progress per session. Incremental scans compare `listSnapshots` revisions and read observations after the stored cursor. Token totals use actual `assistant/message.data.usage`; coverage is reported without estimating missing usage. Skill counts read only the name in `tool/call` skill JSON. Fork/subagent seed events are excluded using `seedLength`.

The 365-day heatmap adapts to the available width with today at the right. The profile avatar is centered above a single statistics row; the overview does not duplicate the account name and organization or display tool/skill rankings. Longest active duration uses `llmMs + toolMs`, excluding idle time. Optional `enterpriseAccounts` decorations have no hard dependency; the fallback is a local usage overview rather than an invented user identity.

Observers are read-only and released immediately. A scan has a 30-second overall bound; unreadable sessions are skipped with a visible report.

The package includes both Host and Web UI and requires only `sessionQuery`. With standard `sessionPersistence`, it uses a persistent incremental index; otherwise it falls back to read-only Session Observation. Enterprise identity value `other` is treated as a generic placeholder rather than a real name.

## Configuration

```yaml
- insert:
    - id: local-activity-insights
      name: '@chatecnu-work/dsh-activity-insights-native'
```

Optional settings: `cacheMs` defaults to 60,000 (10 seconds–10 minutes); `concurrency` to 2 (1–4); `requestTimeoutMs` to 30,000 (5 seconds–2 minutes); `profileTimeoutMs` to 3,000 (0.5–10 seconds). `cacheNamespace` must be a safe local namespace.
