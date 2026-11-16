# User guide and first-run tour

[中文](README.md)

Ships an offline user guide and plays a short tour the first time the workbench opens.

## User guide

The Host serves the static pages in `guide/` at `/eduwork-user-guide/`. Once the desktop shell sees this route, the application menu shows **User Guide**, which opens the guide in an in-app panel; Esc, the close button or a click outside closes it. Distributions that provide an account menu service (`accountMenuEntries`) also get an entry there; without it nothing is shown and loading is unaffected.

- The bundled quick start uses system fonts and works offline. An edition can also supply an online handbook. Its online/offline switch stays in the panel even if the website fails to load. External new-window links open in the system browser.
- Only HTML, CSS and images inside `guide/` are served; `..`, hidden files and unknown types are refused, and responses carry `nosniff` and a `default-src 'none'` CSP.
- The panel passes `?theme=light|dark` from the app's theme setting, and the server writes `<html data-theme>`.

## First-run tour

Plays once after the workbench first opens: only when the plugin settings have loaded, the composer is on screen and no other modal (such as the upstream welcome notice or a sign-in window) is open. A mask highlights the target; the card goes right of it, then below, above or left. ← → move, Esc skips. Finishing or skipping writes `tourSeen` (volatile, stored per entry id in `cordis.patch.yml`), so it does not autoplay again; **Replay tour** in the guide panel plays it again. Unloading the plugin closes the tour without recording it.

Eight built-in steps: welcome, new session, workspaces, composer, permissions and model, skills and plugins, files, user guide. DSH class names change between builds, so targets are found by accessible labels and button text in both Chinese and English; a step whose target is missing is centered and dims the window. After a DSH upgrade, walk through the tour in a test build to confirm each highlight.

It coexists with the upstream welcome notice that `brand-settings-native` writes to `ui-onboarding`: the tour waits while the notice is open.

## Distribution settings

Override the `eduwork-user-guide` entry in the distribution configuration. The default texts live in the [Simplified Chinese](locales/zh-CN.json) and [English](locales/en.json) catalogs.

| Field | Default | Purpose |
| --- | --- | --- |
| `productName` | `EduWork` | Substituted for `{product}` in the copy |
| `autoStart` | `true` | Start automatically on first use; the guide panel also allows manual replay |
| `guideUrl` | Unset | Cross-origin HTTPS URL of the edition's handbook. Opens when online with the offline guide available in the toolbar. Unset editions open the bundled quick start. |
| `copy` | `{}` | Override individual fields by locale and step ID |

A distribution that changes only the Chinese explanation for the new-session step can use this configuration.

```json
{
  "id": "eduwork-user-guide",
  "config": {
    "copy": {
      "zh-CN": {
        "steps": {
          "new-session": {
            "body": "在新会话中开始一项校园任务。"
          }
        }
      }
    }
  }
}
```

Missing, blank or invalid fields use the public default in the same language. The plugin owns step order, targets, navigation and replay. Updating copy preserves the user's first-run completion state.

Each locale has 28 fields.

- `steps` contains a `title` and `body` for each of the eight steps.
- `ui` contains tour buttons, online and offline switches, the progress format, the panel title, Close, Replay and the account menu entry. The progress format accepts `{current}` and `{total}`.

## Updating the guide

Edit the bundled quick start in `guide/index.html`. Editions with a `guideUrl` maintain the full handbook on their own website. The online page must allow cross-origin iframe embedding and loads when the guide panel opens. The first-run tour runs locally.

## Development

`lib/client.js` is generated from `src/client.ts` and committed; product assembly rebuilds it with `build-pinned-dsh-plugin-clients.mjs`. Tests: `node --test test/*.test.mjs`.
