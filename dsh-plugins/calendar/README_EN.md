# EduWork calendar plugin

[简体中文](README.md) | **English**

A local calendar and schedule manager. The calendar opens in month view and keeps the focused date when switching to week view. Both use the same events and private notes. With a school calendar selected, the academic-year overview links each phase to its month. The public desktop edition bundles this plugin starting with 0.4.14. Academic calendar data is supplied by the distribution.

## Features

- Select a date in month view to see its agenda. Use New event to create an all-day or timed entry for that date. The +N link reveals additional entries. Choose or filter calendars under Manage calendars → Calendar sources.
- The week view places events on an hourly axis, splits overlaps into columns, and displays all-day and multi-day entries. Click or drag-select empty time to create an event. Classes with a teaching-class ID share a color across the month, week and daily agenda.
- Create, edit and confirm deletion. Choose no repetition, daily, weekly or selected weekdays, with an optional end date. Selected weekdays also support a week interval.
- Move or cancel one occurrence without changing the others, and undo a move. Open Occurrence times on the event record to see or restore cancelled dates.
- Edit remarks and notes directly from event details. Enable Include my remarks to export remarks in ICS. The option is off by default. Private notes stay on the device and follow rescheduled occurrences that retain their original identity.
- Import an ICS file by selection, drag-and-drop or pasted text. The filename supplies the default calendar name. Distinct calendars coexist; a matching identifier within one calendar updates that event. Missing entries are preserved unless removal is explicitly enabled for that calendar.
- Select an imported calendar to delete it with confirmation. Other calendars, private notes, remarks and reminder settings are preserved. The default personal calendar and managed school calendars cannot be deleted through this action. Managed calendars display their registered labels.
- Copy or download ICS. It excludes private notes and is not a complete backup.
- Choose whether a note, remark, visibility setting or reminder applies to one occurrence or the whole series. Restore hidden occurrences under Manage calendars → Event records.
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

The public plugin registers, enables and updates sources. Institution plugins own authentication, fetching, conversion, polling and login/reconnect retries. Stable identities separate accounts and logical feeds; failures retain cached data, and unregistering hides cached events without deleting notes. The [academic-calendar plugin](../../packages/dsh-academic-calendar/README_EN.md) supplies education semantics, calendar selection and complete timetable imports. Remote school APIs remain unconnected. Attributing a school reschedule requires information identifying the original occurrence; ambiguous changes are reported rather than guessed. Automatic association after a change to the entire recurrence rule is unsupported. See the [source and reminder interface guide](../../docs/proposals/calendar/INTEGRATION_EN.md).

Annotation providers registered through `registerAnnotations` supply teaching weeks, examination phases, and breaks. Week labels appear in the week subtitle and beside each Monday in the month grid. Highlighted phases appear above the corresponding dates with their ranges. A query can target the selected provider in a `group`. When a view requests original calendar dates with `includeOriginalSpan`, providers can return `originalFirstDay` and `originalLastDay` for clipped endpoints. The academic-year overview reads the selected `academic-calendar` provider. An answer that throws, times out (three seconds per provider), or fails validation is dropped without affecting events or other providers.

Calendar source descriptions are read-only and included in exports. ICS includes personal remarks only when opted in. Notes and other personal settings stay on the device. Unattributed descriptions and extension metadata from older versions are backed up for review in personal settings.

## Build and validation

The project-pinned compiler builds the client through `build-client.mjs` / `build-client.ps1`, called by the shared product assembly flow. FullCalendar is bundled into the calendar client. When the plugin is assembled, React, UI primitives and the active palette come from the host. See the [module proposal](../../docs/proposals/calendar/README_EN.md) and [package development guide](../../docs/PACKAGES.md).

After preparing the project Runtime, set `EDUWORK_TEST_RUNTIME` to its `product/d` directory and run `npm test` in this plugin directory. Run `npm run test:browser` for browser panel checks; the default browser channel is locally installed Edge, overridable through `EDUWORK_BROWSER_CHANNEL`.

Browser checks mount the real panel and calendar service with stand-ins for base UI primitives. They verify panel interactions, not the full desktop shell, a live model conversation or a school API.

After starting the full desktop with isolated data, set `EDUWORK_DESKTOP_TEST_CDP` to its loopback debugging address and run `npm run test:desktop`. This check uses the product's actual UI primitives, fills and saves recurring events at two window sizes, and removes its own test records. Use a dedicated acceptance environment.
