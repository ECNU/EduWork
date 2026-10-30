# dsh-calendar-subscriptions

[简体中文](README.md) | **English**

The calendar subscription plugin: it owns the fetching half of remote calendar feeds, pulling ICS subscriptions on a schedule into the local calendar.

## Boundaries

- This plugin owns: per-feed configuration (label, URL, refresh interval, enable/disable), HTTP fetching, scheduled refresh, startup catch-up, retries, and each feed's last success time and error.
- The generic calendar (`@eduwork/dsh-calendar`) owns event storage, personal notes and reminders, and the panel. Snapshots enter only through the calendar's registered-source seam, so subscriptions share the parser and snapshot semantics with manual imports: a failed refresh keeps the previous events, repeated refreshes create no duplicates, and unsubscribing clears that feed's events while personal content survives.
- ICS is built in. Education registers structured calendar/timetable adapters through the public format interface.

## Usage

The service is available as `ctx.calendarSubscriptions`:

- `addFeed({ label, url, format?, intervalHours, profileID? })` — add a feed and fetch it once now (default interval24 hours, range1–720 hours).
- `feeds()` — list feeds with sync status (last success time and last error included).
- `refresh(id)` / `refreshAll()` — refresh one feed or every enabled feed now.
- `updateFeed(id, { label?, intervalHours?, enabled? })` — rename, change the interval, or pause and resume (pausing stops refresh and hides events without deleting them).
- `removeFeed(id)` — unsubscribe and clear that feed's events; personal content survives.

Agent-facing tools (`calendar_subscriptions`, `calendar_subscribe`, `calendar_update_subscription`, `calendar_unsubscribe`, `calendar_refresh_subscriptions`) are registered by `lib/tools.js`; writes follow the host permission decision (they ask first by default). The skill documentation lives in `skills/calendar-subscriptions/`.


For authorized feeds, the host configures `authorizedServices: [{ profileID, url }]` with exact HTTPS URLs. `addFeed({ url, profileID })` reuses OIDC `accountIdentity` and `authorizedFetch`; requests reject redirects. No tokens are persisted. Different accounts use separate source identities; sign-out or account replacement immediately hides old sources and invalidates pending responses. Older OIDC versions without these host capabilities fail explicitly.

See the adapter lifecycle below. Status and warnings are available through the service and management tools.
## Education formats and adapter lifecycle

The optional education package registers `academic-calendar` and `academic-timetable`; see [its formats and examples](../../packages/dsh-academic-calendar/README_EN.md). The source ID is stable for each format, URL and account; existing ICS IDs remain compatible.

`registerFormat(id, { read(response), openSource? })` is disposable. Default readers return `{events, skipped, degraded}`. A structured adapter may provide `openSource({ identity, label, active? })`, returning a source handle with source, ready, beginUpdate, setActive, clear, status and dispose. Its reader returns `{data, skipped, degraded}` and its receipt applies `{data, complete}`. The owning plugin validates/persists semantics using public calendar APIs. Removing a format cancels and detaches its feeds; registering it later restores saved configurations.

Incomplete/failed reads keep successful data; warnings are persisted and exposed. Requests time out after 30 seconds and bodies are limited to 5 MiB. Refresh intervals are 1–720 hours with bounded timer chunks. Refreshing requires the Host to run; restarts catch up and failures retry without desktop integration.

HTTP authorized test services require explicit allowInsecureDevelopment in both the subscription Host and OIDC Profile, and literal loopback IPs only. Production authorized destinations default to HTTPS.
