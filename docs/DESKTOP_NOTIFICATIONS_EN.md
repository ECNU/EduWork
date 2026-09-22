# Desktop notifications

[简体中文](DESKTOP_NOTIFICATIONS.md)

The Electron client can notify you about questions, approvals, completed turns and Studio artifacts while running in the background. Clicking a notification or tray item returns to its conversation. Questions and approvals are still handled inside the application.

## Events and pending items

| Event | Behavior |
| --- | --- |
| Questions, plan review, permission approval | Ask the user to return; clear the pending item after an answer, rejection or cancellation |
| Completed root conversation turn | Notify completion; reading that conversation in the foreground marks it as read |
| Final turn error, blocked turn or output limit | Notify that attention is needed; failures and cancellations are never reported as success |
| Completed or failed Studio artifact | Notify independently after the turn's revisions settle, ignoring intermediate attempts |

Individual tools, child agents, streaming chunks, automatic retries and routine token refreshes do not notify. Foreground use stays quiet; items from other conversations remain in the tray. Events are coalesced, deduplicated and rate limited. Reconnecting does not replay history.

The tray shows a count and a menu of pending items. Dismissing a system popup does not answer or approve anything. Resolved requests disappear automatically; viewing a conversation or the matching Studio artifact clears completion notices. Clicking a stale notice neither recreates a request nor executes an old approval.

## Preferences

Settings → General → Desktop notifications offers the master switch, categories, sound and title previews. Personal choices apply immediately and override the initial defaults in `eduwork.jsonc`.

```jsonc
{
  "schemaVersion": 1,
  "desktop": {
    "closeAction": "tray",
    "notifications": {
      "enabled": true,   // Background popups; tray items remain when disabled
      "attention": true, // Questions, plan review and approvals
      "completed": true, // Completed root turns
      "failed": true,    // Final failures, blocked turns and output limits
      "studio": true,    // Completed Studio artifacts
      "sound": false,    // Allow notification sound
      "preview": false   // Conversation/artifact title only, never body content
    }
  }
}
```

Sound and previews are off by default. Notifications never include answer bodies, commands, file contents or tokens. The application must remain running, including minimized to the tray; quitting, logging out or shutting down stops notifications. Pending items are process-local and old popups are not replayed after restart. No push server is required.

## Windows and macOS

Both platforms share event state and preferences. Windows uses the existing tray's `displayBalloon`, without adding Start menu shortcuts or registry entries. macOS uses Electron `Notification`; its menu bar also shows the pending count.

The OS may suppress popups because of notification permissions, Do Not Disturb or platform restrictions. EduWork does not bypass them with custom popups; tray items remain available. A successful API call does not prove a notification was seen. macOS signing, notification permissions and release-package behavior require native acceptance.

Exact Studio artifact navigation and read acknowledgements need the Studio client changes included in this feature. Before a desktop release, publish and pin that package using the [package workflow](PACKAGES_EN.md). Editing package source does not replace the current npm lock.

## Development and validation

The Host observes live DSH session events and question lifetimes, then synchronizes structured state to Electron through an authenticated local bridge. Clicks are revalidated by the Host and use public conversation/right-sidebar navigation APIs. The renderer receives neither bridge credentials nor notification APIs for running commands or granting approvals.

```sh
node --test dsh-electron/tests/task-notifications.test.mjs dsh-electron/tests/native-vault.test.mjs
```

Set `EDUWORK_TEST_RUNTIME` to a verified Runtime's `d` directory for `dsh-plugins/desktop-services/test/attention-host.test.mjs`. The browser test `dsh-plugins/workbench-native/test/notifications-browser.mjs` also requires `EDUWORK_TEST_BUILD_TOOLS` and `EDUWORK_TEST_EVIDENCE`, pointing to the pinned compiler and an isolated output directory.

Native acceptance must cover background/minimized/tray use, another foreground conversation, OS DND and denied permissions, multiple pending items, historical clicks after resolution, restart, and existing Studio tabs and tab changes. Test both platforms with actual release packages; browser checks do not certify native notification delivery.
