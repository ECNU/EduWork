# EduWork calendar plugin

[简体中文](README.md) | **English**

A local calendar and schedule manager. The week view arranges time within a day; the month view provides a monthly overview. Both use the same events and private notes. This plugin is in development.

## Features

- An empty calendar shows the week grid. Switch between week and month, navigate dates, return to today, and filter by calendar source.
- The week view places events on an hourly axis, splits overlapping entries into columns, and displays all-day and multi-day entries. Drag or double-click empty time to create an event. The month view supports creation on a date and expanding additional entries.
- Create, edit and confirm deletion. Choose no repetition, daily, weekly or selected weekdays, with an optional end date. Selected weekdays also support a week interval.
- Move or cancel one occurrence without changing the others, undo a move, and restore cancelled dates from the record page reached through the event menu.
- An event description is exported in ICS. A private note belongs to one occurrence, is stored separately and is excluded from ICS. Rescheduling preserves the note when the occurrence retains its original identity.
- Import an ICS file by selection, drag-and-drop or pasted text. The filename supplies the default calendar name. Distinct calendars coexist; a matching identifier within one calendar updates that event. Missing entries are preserved unless removal is explicitly enabled for that calendar.
- Copy or download ICS. It excludes private notes and is not a complete backup.
- Agent tools read, create, edit and delete events; move, reset, cancel or restore one occurrence; and read, save or clear private notes. Writes follow the project's existing session permission policy.

Events and private notes are stored on this machine. Reminder settings and notification delivery are not implemented.

## Agent tools

| Tool | Purpose |
|---|---|
| `calendar_list_events` | Read a date range, including source, description and stable occurrence identity |
| `calendar_create_event` / `calendar_update_event` | Create or edit an event and its description |
| `calendar_delete_event` | Delete an entire event |
| `calendar_occurrence` | Move, reset, cancel or restore one occurrence |
| `calendar_notes` | Read private notes, including preserved notes whose occurrence can no longer be found |
| `calendar_put_note` / `calendar_remove_note` | Save or clear a private note for one occurrence |

Use the `source` and `uid` returned by a read for imported events. Notes additionally require the returned `originalStart`, rather than the current rescheduled time. Editing a whole event and editing one occurrence are separate operations.

## Institution integration

The public plugin supplies generic events without school credentials, data fetching or institution-specific timetable rules. Timetables and academic calendars can enter the `calendar` service as distinct sources. Live school synchronization and separate academic-calendar/timetable entries are not integrated. Attributing a school reschedule requires information identifying the original occurrence; ambiguous changes are reported rather than guessed. Automatic association after a change to the entire recurrence rule is unsupported.

## Build and validation

The project-pinned compiler builds the client through `build-client.mjs` / `build-client.ps1`, called by the shared product assembly flow. React and UI primitives come from the host. See the [module proposal](../../docs/proposals/calendar/README_EN.md) and [package development guide](../../docs/PACKAGES.md).

After preparing the project Runtime, set `EDUWORK_TEST_RUNTIME` to its `product/d` directory and run `npm test` in this plugin directory. Run `npm run test:browser` for browser panel checks; the default browser channel is locally installed Edge, overridable through `EDUWORK_BROWSER_CHANNEL`.

Browser checks mount the real panel and calendar service with stand-ins for base UI primitives. They verify panel interactions, not the full desktop shell, a live model conversation or a school API.
