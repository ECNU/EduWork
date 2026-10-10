# EduWork calendar plugin

[简体中文](README.md) | **English**

The public-edition calendar and schedule panel: an entry in the left sidebar, a week view laid out on an hour axis plus an event page in the main area, local storage for event records in the Host half, ICS import and export, and a data-injection point reserved for the institution edition.

Status: in development. The Host half (event model, local storage, `calendar` service) and the client data channel are in place; the week view draws the week on a whole-day hour axis (today highlighted, events that overlap in time side by side) and opens scrolled to where this week's events are, and clicking one opens its details dialog; the header's "新建日程", the empty-calendar card and a drag or a double click on an empty slot all create an event, and the event page edits its title, date, times, place and note in the left column while the last year of occurrences is listed by month in the right, where one date can be moved, cancelled, restored or the whole record deleted; an import accepts a dropped file or pasted text, an export can be copied or downloaded, and the model can change this calendar too — five tools cover reading a range, creating, updating, deleting and moving or cancelling a single date, each write behind a user confirmation. Scope, the event data structure and institution boundaries are described in the [calendar and schedule module proposal](../../docs/proposals/calendar/README_EN.md).

The public edition is a calendar, not a timetable: the only record here is an event. A school timetable, an academic calendar and the registrar's rules arrive as data sources injected by an institution plugin, as described in the [proposal](../../docs/proposals/calendar/README_EN.md).

## Capabilities

- Sidebar entry: registered into `sidebar.panellist`; selecting it switches the main area to this panel.
- Week view: seven days as columns on one whole-day hour axis, with hour marks down the left and today's column highlighted; a line marks the current time. Events that overlap in time take separate columns instead of covering each other. Previous/next/current week navigation, with this week's count.
- Drag to create: press on an empty slot and drag out a span (snapped to fifteen minutes) and the create dialog opens on that range; a double click on an empty slot creates a one-hour entry.
- Whole-day records live in the day header: an entry created here always carries a start and an end time, while a whole-day record that arrives from a calendar file (`DTSTART;VALUE=DATE`, which is what holiday and academic-calendar feeds are made of) still imports and still shows — as a small "全天" chip in the day's header, and a record spanning several days appears on every one of them. It takes no slot on the axis, stays visible while the axis is scrolled, and opens the same dialog; a whole-day record belongs to no time of day, and this way it cannot be scrolled past.
- Where it opens: the axis draws the whole day and the view scrolls to where this week's events are, so a tall panel is filled with hours instead of leaving empty space below a fixed working day; a week with nothing in it stays on working hours.
- Event details: clicking any event opens a dialog with its time, place, source and repeat rule, and the actions that fit it — move it or its place, withdraw a move, cancel one date, or delete the whole record; a start that moves on its own takes the end with it, so the entry keeps its length, while a whole-day entry has no clock and the dialog points at its page for the date and the place.
- Creating and editing: the header's "新建日程", the empty-calendar card and a double click on an empty slot in the week all open the create dialog, the double click with that slot already filled in; the dialog takes a title, date, start and end time, place and note, and can turn on "每周重复". Saving returns to the week, with the new event where it was asked for. The event page edits the same fields directly in its left column, and one occurrence can be handled on its own from the right.
- Recurrence: weekly rules are expanded into occurrences, honouring `interval`, `count`, `until` and `byDay`; `exceptions` cancel one date and `overrides` change one date.
- Event page: opened from the "日程" menu in the header (which lists every event) or from a title in the week view. The left column edits the title, date, start and end time, place and note, and lists the record's cancelled dates with a restore button; the right column lists the last year of occurrences grouped by month, and clicking one opens the same details dialog.
- Import and export: an import is a dialog that accepts an `.ics` file dropped on the panel or on the dialog itself, or pasted text, and reports what it wrote, removed, skipped or degraded in that same dialog; an export dialog offers the calendar text to copy or download.
- Event records: the `calendar` service reads, writes, queries by range, queries occurrences, imports snapshots and imports/exports ICS; records stay on this machine.

## Interface

- A time axis, not a list of cards: the first thing a calendar shows is time. A day is a column, an hour is 48 pixels, and an event is a block positioned by its start and end — so "one event ends at 10:00 and the next starts at 10:00" reads as two blocks that touch, not as two lines of text.
- Overlaps share the width: events that overlap inside one day form a group and split that day's width evenly; once the group ends (the next event starts no earlier than the group's latest end) the full width comes back. The date is part of a block's identity too: two events that both start at 08:00 but fall on different days are not in conflict. That geometry is a pure function (`src/layout.js`) with no React in it and 15 tests of its own.
- A whole-day axis: the axis spans 24 hours and the view opens scrolled to the hour of this week's first event, so a tall panel shows more hours rather than empty space below a fixed working day. Stepping through weeks moves the content, not the axis.
- Colour follows the source: events from one data source share a tint, one for the ones you create and another for an imported `.ics`; the source is not decoration, it is who wrote the record.
- Empty time stays empty: nothing is drawn where no event is, and no "no events" label is written into the grid; when the whole calendar is empty the panel shows one card explaining that an event can be created or an `.ics` file dropped on it.
- The product's own primitives: buttons, dialogs, menus, inputs, switches, tags and icons come from the host's `@deepseek-ai/dsh-client-ui-primitives`, so light and dark themes and keyboard behaviour match the rest of the shell. The two shipping lines carry two generations of that package: the earlier one puts the drawn size in the icon name (`IconPlusOutline16`), the later one drops it and offers stroke variants with the size as a prop (`IconPlusOutlineRegular`). The components are the same in both, while each icon is resolved from whichever names the running shell actually exports (see `icon()` in `src/client.ts`), so the panel draws inside either shell instead of importing a name one of them lacks.

## Data model and storage

- Event fields: `uid`, `title` and `start` are required; `end`, `location`, `description`, `recurrence`, `exceptions`, `overrides`, `source` and `extensions` are optional. `description` is the calendar's own note (the ICS `DESCRIPTION`).
- Times are local strings (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`) and the first version does no timezone conversion; field names follow the ICS vocabulary (`UID`, `SUMMARY`, `DTSTART`, `DTEND`) and unrecognized fields are kept verbatim in `extensions`.
- Recurrence supports weekly rules only: `freq`, `interval`, `count`, `until`, `byDay`. Rules outside that range (monthly, yearly, `BYMONTHDAY`, `BYSETPOS`) are imported by keeping the original RRULE text in `extensions` and degrading the event to a single occurrence instead of dropping it silently.
- Records live in one table of a local storage domain: `events` keyed by `uid`. A write is durable before it becomes visible, reads come from in-memory state, and changes are announced as `domain/changed`; nothing is networked, uploaded or logged. The assembly decides the medium behind the domain — the plugin holds no paths.
- `snapshot()` returns the whole dataset with its `schemaVersion` (`{ schemaVersion, events }`); imports merge by `uid`, so importing the same snapshot twice leaves the same result, and every record is validated before the first write, so a rejected import leaves no half-written copy behind.
- Writes go through `putEvent({ ...record })`: the caller brings its own `uid` (the interface generates `manual-<uuid>` for a new event), the call inserts or replaces the whole record, and a missing `source` becomes `manual`. There is one record shape, and what was written is what is read back.

### Recurrence, moves and cancellations

What is stored is a **series**; what a view shows is an **occurrence**: `occurrences({ from, to })` computes them per call and keeps no per-week copy, so no week can go stale. Each occurrence carries `occurrenceId` (`<uid>#<date the series produced>`) and `occurrenceDate`, which the interface renders by and which later reminders and classroom notes will refer to.

| Case | Representation | Note |
| --- | --- | --- |
| Cancelled (not this time) | `exceptions: ['2026-03-16']` | The ICS `EXDATE` case |
| Moved or relocated | `overrides: [{ date: '2026-03-23', start: '2026-03-27T14:00', location: '示例楼 202' }]` | The ICS `RECURRENCE-ID` case: only changed fields are written, the rest inherit from the series, and `date` is the date the series produced, so a later change to the series time cannot break the match |
| An extra date | A record of its own | It belongs to no series and carries its own `uid` |
| Long-term change (new room from week 9) | Split the series | The old series ends at week 8 through `until`, a new series starts in week 9 (`uid` changes): `RRULE` cannot express "changed from week 9 on" |

The service exposes `applyOverride({ uid, date, patch })` and `removeOverride({ uid, date })` to record or withdraw one move, and `cancelOccurrence({ uid, date })` / `restoreOccurrence({ uid, date })` to cancel or restore one date. Two overrides on the same `date` are rejected, and so is an empty one that carries only `date`: the contract has no move that changes nothing. Cancelling a date also withdraws a move that had been scheduled for it — there is nothing left to move.

A one-off event takes a different path: changing it edits the record itself, because an override on it would be a `RECURRENCE-ID` on a `VEVENT` without `RRULE`, which RFC 5545 does not allow.

### How the stored shape evolves

The record contract used to carry `courseId`. It is no longer a public field, but an older record may still hold it: the domain is read with `StoredEventSchema` (the public contract plus such retired fields), and `CalendarStore.open()` rewrites those records into the current shape once, after which they cannot come back. The domain version stays 1 — the backend validates the version of the whole unit, and a bump would make every store written before the change fail to open, which is far worse than reading one extra field. That same open is also what drops a retired table from an older store at the first write.

## Client data channel

- The Host half marks `snapshot`, `occurrences`, `importIcs`, `exportIcs`, `putEvent`, `deleteEvent`, `applyOverride`, `removeOverride`, `cancelOccurrence` and `restoreOccurrence` as remote methods (`Remote(...)` in `lib/index.js`) and hands them to the gateway through the package's `./typert` export (`lib/typert.host.js`); the wire contract's zod schemas live in `lib/typert-schemas.js` and reuse the record schemas, so the two descriptions cannot drift apart.
- Both faces (`./typert` and `./remote`) take their descriptor list from one `lib/typert-descriptors.js`, so method names, arguments and schemas cannot be written down twice and disagree; a test also checks that every descriptor points at the line of the method that implements it.
- Each remote method takes one object argument and returns one JSON value. The client half mounts the package's `./remote` export (`lib/typert.remote-client.js`): it calls `ctx.remote.$mount(...)` first and then, inside `ctx.inject(['remote.calendar'], ...)`, for example `remote.calendar.occurrences({ from, to })` for `{ schemaVersion, occurrences }` (one round trip carries the whole week) or `remote.calendar.putEvent({ uid, title, start })` to write one event. The gateway answers `{ ok, value }` or `{ ok, error }`, which the client unwraps before rendering.
- The interface asks for the week it shows: moving to another week is another range query, with no cache and no per-week copy; the event page asks for a window of roughly a year and stores nothing either. Every write is followed by a fresh read, so what is on screen is what the records say. `snapshot()` stays for callers that need the whole dataset, such as export and institution injection.
- The panel registers only while the remote surface is available, so an unavailable data host never leaves a blank panel behind.

## Agent read and write interface

`lib/tools.js` opens the same `calendar` service to the model in a session, with five tools covering reads and writes:

| Tool | What it does |
| --- | --- |
| `calendar_list_events` | Reads every occurrence in a range of dates, giving each one its `uid`, date, time, place and whether it repeats weekly |
| `calendar_create_event` | Creates one record, optionally with `repeat: "weekly"` and an `until` date |
| `calendar_update_event` | Updates one record by `uid`, changing only the fields the call carries; moving the start keeps the entry's duration |
| `calendar_delete_event` | Deletes one whole record by `uid` |
| `calendar_occurrence` | Acts on one date of a series: `move`, `reset`, `cancel` or `restore` |

Every window is bounded: without `from` a read starts 180 days before today, without `to` it ends a year later, and no single call may span more than 3660 days. That is not caution for its own sake — a weekly series with no end date expands up to whatever bound it is given, so an unbounded window would ask for four thousand years of dates. A write carries only what it changes: a field left out keeps its stored value, and an empty string clears one.

Writes pass one confirmation on `tools/pre-execute` (`lib/tool-permission.js`): reads go straight through, writes ask, a session already running without approvals goes through, and a write with no session behind it is denied. The tools and the panel write the same records through the same validation; there is no second implementation.

## Interfaces used

| Interface | Purpose | Requirement |
| --- | --- | --- |
| `sidebar.panellist` | Panel entry in the left sidebar | List slot; an entry needs `id` and optionally `order` and `label` |
| `main` | Main-area panel | Keyed slot; the `key` equals the sidebar `id` to switch between them |
| `storageDomain` | Persistence for event records | Domain-table storage; the domain opens during plugin initialization |
| `remote` (Typert gateway) | Client half reading and writing Host records | Host face registered through `./typert`, client face mounted through `./remote`; `snapshot`, `occurrences` and eight write methods cross the boundary, every other method belongs to the Host half alone |
| `@deepseek-ai/dsh-client-ui-primitives` | Buttons, dialogs, menus, inputs and icons of the client half | Provided by the host and never bundled; declared in `dsh.client.inject` and `peerDependencies`. Both lines name the components alike but name their icons in two generations, resolved from what the runtime exports |
| `tools`, `permissionPresets` | Registering the Agent tools and confirming writes | `ctx.tools.register(defineTool(...))`; `tools/pre-execute` answers `ask` or `deny`, and `permissionPresets.current()` reads the current approval preset |

The plugin declares itself removable without intruding on the core (`chatecnuWork` in `package.json`: `kind` is `ui-extension`, `removable` is true) and keeps zero runtime dependencies.

## Build

- Client half: during assembly `build-client.ps1` compiles `src/client.ts` together with the `src/layout.js` it imports into `lib/client.js` (`tsdown`, configured in `tsdown.config.ts`). The script takes `-Upstream` (the compiler toolchain) and `-RuntimePackages` (the runtime's `node_modules`) from the assembly and links that `zod` into its temporary build directory, removing only the link afterwards. `react` and `@deepseek-ai/dsh-client-ui-primitives` are external and never bundled. The compiler toolchain is prepared by the assembly flow and is not part of this repository.
- Host half: `lib/model.js` (the record contract), `lib/store.js` (domain access), `lib/ics.js` (ICS parsing and writing), `lib/tools.js` (the Agent tools and their write confirmation), `lib/typert-schemas.js` (wire schemas), `lib/typert-descriptors.js` (the remote descriptors both faces share), `lib/typert.host.js` (host face), `lib/typert.remote-client.js` (client face) and `lib/index.js` (the `calendar` service) are hand-written source, copied as-is during assembly.
- Registration: the plugin list and `localPlugins` live in `config/distributions/generic.json` and `config/assembly.eduwork.json`; the Agent tools are the same package's `./tools` subpath, installed into the composition by an `insert` row in `patches` (the same form `search-auto` uses), so the panel and the tools are two entries of one package.

## Tests

`node --test test/*.test.mjs` (or `npm test`). The tests take `zod`, the storage packages and the Typert protocol from the Runtime pinned by the assembly: point `EDUWORK_TEST_RUNTIME` at a runtime directory to run them, otherwise they skip; CI runs the same command once the runtime is prepared. All 81 cases pass on both pinned runtime lines — `release-v0.1.5-rc.2` for the generic Web product and `candidate-v0.2.0-rc.2` for the desktop candidate; a parameter codec needs `create()`, and without it the loader check rejects the manifest on the latter line. `test/model.test.mjs` covers the record contract and the snapshot (8 cases), `test/occurrence.test.mjs` covers occurrence expansion with `exceptions`, `overrides` and the days a record spans (16 cases), `test/ics.test.mjs` covers the field mapping, line folding and escaping, the `RRULE` subset and its degradation, `EXDATE`/`RECURRENCE-ID`, the syntax of what we export, and a round trip that loses nothing it did not understand (18 cases), `test/remote.test.mjs` checks that both faces describe the same methods, parameters and result schemas, that every descriptor points at the method that implements it, and that the manifest passes loader validation (5 cases), `test/store.test.mjs` uses a real Cordis scope over the JSON backend to verify round-trips, restarts, atomic imports, range queries, moved and cancelled dates, ICS import and re-export, the source-scoped replacement and the migration of an older store, to check that only marked methods appear on the live service's remote surface, and to check that the declared wire schemas parse the payloads the methods really return (9 cases), `test/tools.test.mjs` uses the real occurrence rules to check the service methods and arguments each of the five tools reaches, the bounds on every window, that a write carries only what it changes, and all four outcomes of the write confirmation (9 cases), and `test/layout.test.mjs` covers the axis window, the overlap geometry of the week view and the length a moved start keeps (16 cases, pure functions, no runtime needed, so it never skips on a missing `EDUWORK_TEST_RUNTIME`).

## Documentation

- [Calendar and schedule module proposal](../../docs/proposals/calendar/README_EN.md): goal, scope, event data structure, reminder boundary and institution boundary.
