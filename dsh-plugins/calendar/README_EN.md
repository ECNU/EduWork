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
- Select an imported calendar to delete it with confirmation. Other calendars, private notes, remarks and reminder settings are preserved. The default personal calendar and managed school calendars cannot be deleted through this action. Managed calendars display their registered labels.
- Copy or download ICS. It excludes private notes and is not a complete backup.
- Personal settings support series defaults, occurrence overrides and restoring inheritance for notes, private remarks, visibility and relative/fixed reminders. Hidden occurrences remain manageable from the event menu and record page.
- Agent tools read and edit events, occurrences, notes and personal settings. Writes follow the existing session permission policy.
- Open panels refresh after external source or Agent writes and resubscribe after disconnection.

Events and personal settings stay on this machine. Due relative and fixed reminders enter the Reminder inbox. Desktop builds use system notifications; browsers provide in-app reminders. No model or conversation is started. Keep the app running; restart catches up at most 24 hours, and receipts remain for 30 days. OS popups respect the notification master switch, foreground policy and system quiet settings.

The bundled calendar-management Skill guides event queries, changes, private settings and source imports. Editions may attach references; their plugins initialize school data before any conversation. `calendar_import_source` imports batches with stable IDs in user-owned sources; managed sources require explicit Host opt-in.

## Agent tools

| Tool | Purpose |
|---|---|
| `calendar_list_events` | Read a date range, including source, description and stable occurrence identity |
| `calendar_create_event` / `calendar_update_event` | Create or edit an event and its description |
| `calendar_delete_event` | Delete an entire event |
| `calendar_occurrence` | Move, reset, cancel or restore one occurrence |
| `calendar_notes` | Read private notes, including preserved notes whose occurrence can no longer be found |
| `calendar_put_note` / `calendar_remove_note` | Save or clear a private note for a series or occurrence |
| `calendar_read_personal` / `calendar_personal_settings` | Read, patch or restore personal settings by field |

Use the `source` and `uid` returned by a read for imported events. Occurrence settings require the returned `originalStart`, rather than the rescheduled time. Omit it to address series defaults. Editing a whole event and editing one occurrence are separate operations.

Agent-visible event text includes reusable source/uid/originalStart references. Personal writes reject nonexistent event or occurrence references; preserved unlinked notes remain readable.

ICS files carrying managed institution sources cannot overwrite those sources; their registered writer must update them. ICS is not a complete private-data backup.

## Institution integration

The public plugin registers, enables and updates sources. Institution plugins own authentication, fetching, conversion, polling and login/reconnect retries. Stable identities separate accounts and logical feeds; failures retain cached data, and unregistering hides cached events without deleting notes. Real school APIs and separate academic-calendar/timetable entries are not integrated. Attributing a school reschedule requires information identifying the original occurrence; ambiguous changes are reported rather than guessed. Automatic association after a change to the entire recurrence rule is unsupported. See the [source and reminder interface guide](../../docs/proposals/calendar/INTEGRATION_EN.md).

Source descriptions and private remarks are stored separately. Private content is excluded from ICS. Unattributed descriptions and extension metadata from older versions are backed up for review in personal settings.

## Build and validation

The project-pinned compiler builds the client through `build-client.mjs` / `build-client.ps1`, called by the shared product assembly flow. React and UI primitives come from the host. See the [module proposal](../../docs/proposals/calendar/README_EN.md) and [package development guide](../../docs/PACKAGES.md).

After preparing the project Runtime, set `EDUWORK_TEST_RUNTIME` to its `product/d` directory and run `npm test` in this plugin directory. Run `npm run test:browser` for browser panel checks; the default browser channel is locally installed Edge, overridable through `EDUWORK_BROWSER_CHANNEL`.

Browser checks mount the real panel and calendar service with stand-ins for base UI primitives. They verify panel interactions, not the full desktop shell, a live model conversation or a school API.

After starting the full desktop with isolated data, set `EDUWORK_DESKTOP_TEST_CDP` to its loopback debugging address and run `npm run test:desktop`. This check uses the product's actual UI primitives, fills and saves recurring events at two window sizes, and removes its own test records. Use a dedicated acceptance environment.
