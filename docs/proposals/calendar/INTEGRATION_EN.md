# Calendar source and reminder interfaces

[简体中文](INTEGRATION.md) | **English**

The public calendar validates, stores and displays events and private settings. Data plugins own authentication, fetching, conversion, polling, timeouts, login/reconnect and retries. See [features and limits](../../../dsh-plugins/calendar/README_EN.md).

## Source registration and pushed writes

Register a stable provider/account/feed identity on the Host, without fetch callbacks or timers:

```js
const source = ctx.calendar.registerSource({
  provider: 'example-campus', account: adapter.stableAccountId,
  feed: 'timetable', label: 'My timetable',
})
ctx.effect(() => () => source.dispose(), 'unregister timetable')
const update = source.beginUpdate()
try {
  const data = await adapter.fetchTimetable()
  await update.apply({ complete: true, revision: data.revision,
    events: adapter.toCalendarEvents(data) })
} catch {
  update.fail('sync_failed')
}
```

The returned handle binds writes to its own source. `source.apply(batch)` submits existing data directly; call `beginUpdate()` before external work to supersede older requests. Each receipt accepts one submission. A late receipt returns `superseded`. Managed `sync:` sources cannot be impersonated by ordinary applySource or file import.

Provider, account and feed must be stable, nonempty identifiers, independent of labels, tokens or sessions. A shared academic calendar may use an explicit shared account; personal timetables use separate stable account IDs. Handles do not replace Host authorization.

`setActive(false)` hides cached events and suspends their reminder plans, retaining private data. Reactivation or registration under the same identity restores them. `dispose()` unregisters. `status()` and `calendar.sourceStatuses()` expose safe public state; `update.fail(code)` reports external failure without exposing exceptions or credentials. Fetch cancellation, timers and retry policies remain in the data plugin.

## Complete and incremental batches

A batch is `{events, complete?, revision?}`. Omitting complete updates supplied entries without deleting absent ones. Explicit false rejects incomplete data. True replaces this source only; a successful empty full snapshot clears it.

Events carry `uid/title/start/end?/location?/description?/recurrence?/movedFrom?/cancelledDates?`. Retain stable IDs and original instance references when moving dates. Unattributable changes and entire recurrence-rule redefinitions are reported, not guessed; an unattributable full batch leaves the old snapshot intact. Source descriptions and private remarks remain separate.

Optional revision is an increasing positive integer persisted after successful writes. After restart, older/missing versions and conflicting content under the same version reject; the same batch can be replayed. Record order does not redefine its content. Revision is not part of uid and does not replace original occurrence identity.

Input is validated before queued writes. Storage has no cross-record transaction: disk failure stops remaining writes and cleanup, without rolling back already completed writes.

## Agent imports and the bundled Skill

The public calendar-management Skill uses the same service and permissions as the panel. `calendar_import_source` supports stable IDs in user-owned `agent:<name>` sources; mode defaults to merge; replace has deletion semantics, including empty-source clearing. Host batches retain their separate complete validation.

Managed sources deny Agent batch writes by default. The Host can explicitly opt in with allowAgentUpdates:true; session write permission still applies. Data plugins call their source handle directly.

An edition may select the same sourcePackage/sourcePath and append its own data and guidance links through a references list in the Skill body. It does not copy the Skill instructions. Static calendar initialization runs in the edition plugin once the service is ready, independently of conversations.

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

The default Host-side `ReminderDelivery` reuses `reminderPlan` and invalidations and stores receipts in the independent `calendar_reminders` domain. Relative reminders follow moves and stop on cancellation; fixed reminders remain independent. Browsers do not own timers: due reminders enter a durable in-app inbox, with optional `desktopServices.calendarReminder` forwarding to the existing desktop notification channel. No model or Session is started. `calendar.reminders()` returns channel status, unread count and the latest 100 receipts; `ackReminder({id})` persists read state and clears the tray item.

Keep the Host running. Restart catches up at most 24 hours and receipts remain for 30 days. Stable identity plus scheduled time deduplicates inbox receipts. Bridge failures retry without removing the in-app receipt. OS visibility depends on notification preferences, foreground policy and quiet settings. Bridge acceptance does not prove a user saw the popup. Bridge dispatch and receipt acknowledgment are not a cross-process transaction; a crash can repeat an OS popup, so exactly-once delivery is not promised. Old shells report calendar delivery unavailable rather than bypassing policy or starting a model.

`registerReminderScheduler` remains an optional Host planning interface; integrations must avoid double delivery. DSH Schedule is a separate Session-reminder path.

## Panel invalidation

`calendar.changes(signal)` uses the existing Runtime Remote logical stream for `{revision}` invalidations, coalescing rapid changes. It is not a consistent snapshot or durable event log. The panel rereads current data, resubscribes after disconnection and cancels on unmount. Both source and personal writes trigger refresh.

Week/month views share data. Separate institution academic-calendar/timetable entries, default views and preset source filters remain future work.
