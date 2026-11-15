# User guide and first-run tour

[中文](README.md)

Ships an offline user guide and plays a short tour the first time the workbench opens.

## User guide

The Host serves the static pages in `guide/` at `/eduwork-user-guide/`. Once the desktop shell sees this route, the application menu shows **User Guide**, which opens the guide in an in-app panel; Esc, the close button or a click outside closes it. Distributions that provide an account menu service (`accountMenuEntries`) also get an entry there; without it nothing is shown and loading is unaffected.

- The page uses system fonts, runs no script and loads nothing from the network; outside links open in the system browser.
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

Each locale has 26 fields.

- `steps` contains a `title` and `body` for each of the eight steps.
- `ui` contains five tour button labels, the progress format, the panel title, Close, Replay and the account menu entry. The progress format accepts `{current}` and `{total}`.

## Updating the guide

Edit the public guide in `guide/index.html` and keep its screenshots in `guide/images/`. The guide ships with the client.

An edition can select its own Markdown handbook in `edition/distribution.json`. Assembly builds it as the offline landing page with a local link to the common guide. Editions that omit `userGuide` open the public guide directly.

```json
{
  "userGuide": {
    "source": "docs/USER_GUIDE.md",
    "sourceUrl": "https://github.com/example/edition/blob/main/docs/USER_GUIDE.md"
  }
}
```

Use a level-one heading for the title and level-two headings for the contents. GitHub-style tables are supported. Relative document links resolve against `sourceUrl` and open in the external browser. Reference local PNG, JPEG or WebP screenshots by relative path. Assembly embeds them for offline reading. Redact personal information before adding screenshots.

## Development

`lib/client.js` is generated from `src/client.ts` and committed; product assembly rebuilds it with `build-pinned-dsh-plugin-clients.mjs`. Tests: `node --test test/*.test.mjs`.
