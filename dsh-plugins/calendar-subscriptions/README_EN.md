# dsh-calendar-subscriptions

The calendar subscription plugin: it owns the fetching half of remote calendar feeds, pulling ICS subscriptions on a schedule into the local calendar.

## Boundaries

- This plugin owns: per-feed configuration (label, URL, refresh interval, enable/disable), HTTP fetching, scheduled refresh, startup catch-up, retries, and each feed's last success time and error.
- The generic calendar (`@eduwork/dsh-calendar`) owns event storage, personal notes and reminders, and the panel. Snapshots enter only through the calendar's registered-source seam, so subscriptions share the parser and snapshot semantics with manual imports: a failed refresh keeps the previous events, repeated refreshes create no duplicates, and unsubscribing clears that feed's events while personal content survives.
- ICS is the first format, behind the adapter seam in `lib/ics-adapter.js`. School timetables and academic calendars arrive later as their own adapters and never depend on this plugin's internals.

## Usage

The service is available as `ctx.calendarSubscriptions`:

- `addFeed({ label, url, intervalHours })` — add a feed and fetch it once now (default interval 24 hours, minimum 1 hour).
- `feeds()` — list feeds with sync status (last success time and last error included).
- `refresh(id)` / `refreshAll()` — refresh one feed or every enabled feed now.
- `updateFeed(id, { label?, intervalHours?, enabled? })` — rename, change the interval, or pause and resume (pausing stops refresh and hides events without deleting them).
- `removeFeed(id)` — unsubscribe and clear that feed's events; personal content survives.

Agent-facing tools (`calendar_subscriptions`, `calendar_subscribe`, `calendar_update_subscription`, `calendar_unsubscribe`, `calendar_refresh_subscriptions`) are registered by `lib/tools.js`; writes follow the host permission decision (they ask first by default). The skill documentation lives in `skills/calendar-subscriptions/`.
