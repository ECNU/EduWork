# Calendar source and reminder interfaces

[简体中文](INTEGRATION.md) | **English**

This guide is for institution plugins and Host integrators. The public plugin owns generic events, personal settings and sync coordination. Institutions provide authorization, API conversion and real lifecycle events. See [features and limits](../../../dsh-plugins/calendar/README_EN.md).

## Source registration

An institution plugin depends on `calendar` and registers academic calendars and timetables separately for each signed-in account. `adapter` below is supplied by that institution:

```js
const source = ctx.calendar.registerSource({
  provider: 'example-campus',
  account: adapter.stableAccountId,
  feed: 'timetable',
  label: 'My timetable',
  pollIntervalMs: 300000,
  timeoutMs: 30000,
  fetch: async ({ signal, reason }) => {
    const data = await adapter.fetchTimetable({ signal, reason })
    return { complete: true, events: adapter.toCalendarEvents(data) }
  },
  subscribe: notify => adapter.onSyncTrigger(notify),
})
ctx.effect(() => () => source.dispose(), 'calendar: unregister timetable')
```

`provider`, `account` and `feed` are nonempty stable identifiers. Their tuple determines the source ID; labels, tokens and transient sessions do not. Account identity separation does not replace institution authorization.

Registration starts a refresh. Polling defaults to five minutes, with a one-second minimum; requests default to a 30-second timeout. Optional `subscribe` returns an unsubscribe function and invokes `notify('login')` / `notify('reconnect')` for real institution events. `source.sync()` retries one source; `calendar.syncSources()` refreshes sources independently. `calendar.sourceStatuses()` returns labels, states, last success times and safe error codes, not raw adapter exceptions.

A newer request supersedes earlier responses. Fetch should honor its AbortSignal; the coordinator also ends timeout waits. Disposal stops polling and fetching, hides that account's cached events and stops its reminder plans without deleting data or personal settings. Registering the same identity restores them. Credentials stay in the adapter closure or credential service, never in events. The public plugin fixes no school URL or API format.

## Complete snapshots and incremental writes

Registered fetch adapters must return `{complete:true, events:[...]}`. Failures throw; unfinished pagination or partial parsing must not be represented as a successful empty result. Incomplete or unattributable full results retain the previous snapshot.

Events use `uid/title/start/end?/location?/description?/recurrence?`. Source descriptions belong to the school. A moved occurrence carries `movedFrom`; cancellations carry `cancelledDates`, naming original instances. The recurring baseline and rule remain immutable. Missing original identity or a changed whole recurrence is reported as `unattributable`, without guessed association.

A Host may also call:

```js
await ctx.calendar.applySource({ source: source.source, complete: true, events })
```

The entire batch is validated before committing. Successful full snapshots remove absent records of that source; successful empty snapshots clear it. Full snapshots also replace source moves/cancellations, allowing school restoration, while retaining user overrides and personal content. The storage has no cross-record transaction: disk failures stop further commits and cleanup, without promising rollback of writes already completed.

Omitting `complete` preserves incremental behavior with no absence cleanup. Explicit `complete:false` rejects. File import has its own replace option and cannot use the reserved `manual` or `sync:` source namespace.

## Personal fields and inheritance

`calendar_personal` stores `scope/source/uid/originalStart?` and independent fields:

| Field | Values |
|---|---|
| `note` | `{text:string}` or `{off:true}` |
| `remark` | `{text:string}` or `{off:true}`, separate from source description |
| `hidden` | `true` / `false`, a display preference |
| `reminder` | `{kind:'relative',minutes:15}`, `{kind:'fixed',at:'2026-10-20T20:00'}` or `{off:true}` |

Omit `originalStart` for series defaults. Occurrences inherit per field; empty strings and false are values. Omitted patch fields preserve existing overrides, `clear` removes overrides to restore defaults, and `off` persists a disabled decision. Resolved inheritance is never written back.

```js
await ctx.calendar.setPersonal({
  source: source.source, uid: 'demo-1',
  patch: { note: { text: 'Series note' }, reminder: { kind: 'relative', minutes: 15 } },
})
await ctx.calendar.setPersonal({
  source: source.source, uid: 'demo-1', originalStart: '2026-10-20T09:00',
  patch: { hidden: false }, clear: ['note'],
})
const settings = ctx.calendar.personalFor({ source: source.source, uid: 'demo-1', originalStart: '2026-10-20T09:00' })
```

`notes` reads raw personal records; `personalFor` reads effective settings. Removing a note does not delete reminder or visibility fields. Patches, clears and deletion share the per-target read/merge/write queue. This is a single-process guarantee.

User edits to imported descriptions become private remarks. Pre-upgrade description/extension ownership cannot be inferred reliably, so source receipts retain a review copy, visible in personal settings. Old extension data never automatically enables delivery. Private settings are excluded from ICS.

## Reminder plans and delivery

`calendar.reminderPlan({from,to})` returns `{tasks}` for an event window. Tasks carry stable `id`, `ref`, `title`, `kind` and local due time `at`.

Relative reminders subtract minutes from the actual occurrence start. Same-day and cross-day moves change time under the same ID. Cancellation removes class-relative reminders and retains notes. All-day entries have no implicit class clock and produce no relative-minute task; fixed times are supported.

Fixed reminders are independent personal tasks and keep their time through class moves/cancellations. A series-level fixed reminder produces one task. Hiding an event does not disable reminders; unregistering an account stops its plans.

Connect an existing scheduler through a Host adapter:

```js
const binding = ctx.calendar.registerReminderScheduler({
  replace: async ({ owner, tasks }, signal) => {
    await schedulerAdapter.replaceOwnedTasks({ owner, tasks, signal })
  },
})
ctx.effect(() => () => binding.dispose(), 'calendar: detach reminders')
```

The adapter must replace only calendar-owned jobs, durably deduplicate by `task.id`, update unchanged IDs and cancel absent jobs. Retrying a plan must not produce additional delivery. The default plan contains future tasks within the next year, recomputed after data/settings changes and every minute as the window advances. `binding.refresh()` waits for reconciliation; `binding.status()` reports failures. Failed plans are retried rather than acknowledged.

The public plugin has no actual delivery adapter bound. Existing `@deepseek-ai/dsh-schedule` targets an original Session; integration must select a real Session and reuse its permission semantics. No Session is fabricated and no second desktop notification timer is introduced. Planning and adapter checks are not delivered-notification acceptance.

## Panel invalidation

`calendar.changes(signal)` uses the existing Runtime Remote logical stream for `{revision}` invalidations, coalescing rapid changes. It is not a consistent snapshot or durable event log. The panel rereads current data, resubscribes after disconnection and cancels on unmount. Both source and personal writes trigger refresh.

Week/month views share data. Separate institution academic-calendar/timetable entries, default views and preset source filters remain future work.
