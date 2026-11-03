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

Configuration of the `eduwork-user-guide` entry:

| Field | Default | Meaning |
| --- | --- | --- |
| `productName` | `EduWork` | Product name in the panel title and tour copy (`{product}`) |
| `autoStart` | `true` | `false` disables autoplay; the tour can still be replayed |
| `steps` | `[]` | When non-empty, replaces the built-in steps in order |

Each step is `{ id, title: { zh, en }, body: { zh, en }, selector }`. A built-in `id` keeps its target and copy and overrides only the given fields; a new `id` needs a title and body, and `selector` is the CSS selector of the element to highlight (centered when omitted). Invalid entries are skipped; if none is usable the built-in steps are used. The last step always offers **Open user guide**.

## Updating the guide

Edit `guide/index.html`; it ships with the next client. Put screenshots in `guide/images/` and reference them relatively; hide personal information first, about 2000 px wide, WebP, under 200 KB each.

## Development

`lib/client.js` is generated from `src/client.ts` and committed; product assembly rebuilds it with `prepare-pinned-dsh-product.mjs`. Tests: `node --test test/*.test.mjs`.
