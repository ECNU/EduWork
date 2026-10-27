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
- `refresh(id)` / `refreshAll()` — refresh one feed or all of them now.
- `setEnabled(id, enabled)` — disabling pauses refresh and hides events; enabling restores both.
- `removeFeed(id)` — unsubscribe and clear that feed's events.

Agent-facing subscription tools and skill documentation arrive in a follow-up commit.
