# Academic calendars and timetables

[简体中文](README.md) | **English**

Adds academic years, terms, numbered teaching/examination weeks, breaks and short terms to the DSH calendar, alongside complete meeting lists grouped by teaching class. The calendar selector persists locally. Desktop integration is optional.

Institution plugins call `ctx.academicCalendar.registerDataset({ id, label, dataset })`, receiving a disposable handle. Schema version 2 contains `academicYear`, `terms` with `id/name/firstDay/lastDay/weekCount/phases`, `breaks`, and concrete `events`. Phases carry `kind/name/firstDay/lastDay/weeks`. Optional positive `revision` rejects downgrades and conflicting contents. Numbered phases cover whole weeks capped at the term boundary. Breaks have no teaching weeks; short terms number their own weeks. Only concrete activities become events.

Import complete timetable snapshots with `importTimetable({ institution, account, dataset })`; see [timetable.json](examples/timetable.json). Invalid snapshots keep existing data; an empty list explicitly clears that timetable. Course grouping stays in this plugin. Ordinary events carry `extensions['eduwork.academic']` with institution, term, teaching class, time zone and optional school-issued meeting ID. Times are local to the stated timetable zone; document conversion or an institution adapter resolves teaching weeks and bell times.

Stable school-issued meeting IDs preserve personal associations across moves. Without an ID, class and start/end determine identity; changed times create a new instance, leaving old personal content for confirmation. Legal holidays never rewrite classes.

Combine the calendar, subscriptions and academic-calendar packages with [cordis.patch.yml](cordis.patch.yml), enable `skills/academic-calendar` and the companion calendar/subscription skills, then add institution data separately. Source assembly is for development; maintainers handle npm publication and product locks.

Agent tools: `academic_calendar_query` reads a specified or selected calendar; `academic_courses` reads teaching classes and meetings; `academic_import_timetable` imports reviewed JSON. Existing calendar tools manage events, notes and reminders.

## Remote updates

When subscriptions are available, this package registers `academic-calendar` and `academic-timetable`. Use calendar_subscribe or `calendarSubscriptions.addFeed({ url, format, label, intervalHours, profileID? })`. Calendar responses contain the full calendar JSON described above. Timetable responses are `{ institution, dataset }`, using the [timetable example](examples/timetable.json) shape. Account identity comes from the Host, never from the response.

Subscriptions own fetching, retries, success status and authorization. Education validates/persists full documents, maintains grouping/backgrounds and writes ordinary events through source handles. Revision checks include terms, phases, breaks and events; conflicting same-revision documents and rollbacks are rejected across restart/unsubscription. Unselected calendars continue updating while only the selected background and activities are visible. Disable, logout and disposal also hide education queries. Offline restarts retain successful snapshots; re-enabling restores them.

These adapters provide a reusable route, not a claim that a school API already exists. Static calendars and manual structured imports remain independently usable.
