# Desktop pet

[简体中文](DESKTOP_PET.md)

The Electron client can show a small pet on your desktop. It follows your conversations: it thinks while work runs, shows a mark when something is done or needs you, and opens that conversation when clicked. The pet uses the same items as [desktop notifications](DESKTOP_NOTIFICATIONS_EN.md) and is just another way to see them; approvals and answers still happen in the app.

The public edition ships with the pet turned off; turn it on under Settings → Desktop pet. Four characters are built in: Page (小页), a paper sprite in a red and a blue palette; Dafeiyu (大肥鱼), a whale girl from the DeepSeek fan community; and Huashi (小花狮), the East China Normal University mascot. All characters share the same window, states, animation player and click behavior, so switching characters does not change how the pet behaves.

## States

The pet is one more way to show the same state: Needs you, Failed and Done come straight from the pending items of [desktop notifications](DESKTOP_NOTIFICATIONS_EN.md), with exactly the rules the tray and system notifications use, so turning the pet on or off does not change notifications. When several conversations have items, the first matching row wins:

| State | When | Looks like | Click |
| --- | --- | --- | --- |
| Needs you | A question or an approval is waiting | Raises a hand and looks around; blue "?" | Opens that conversation |
| Failed | A turn failed, was blocked or hit the output limit | Upset for a moment, then calm; red "!" until viewed | Opens that conversation |
| Done | A main turn or a Studio result finished and you have not viewed it in the foreground | Celebrates for a few seconds; "!" or the count of results | Opens that conversation; Studio results open on the result |
| Working | A main conversation is running, or a Studio result is being generated | Mostly thinking, now and then writing | A short reaction; the bubble shows how many conversations are running |
| Napping | You are away (system idle for 5 minutes or locked), or nothing has happened for 10 minutes | Sleeps sitting down; animation paused | Wakes up |
| Idle | Otherwise | Mostly still, sometimes blinks, flips its folded corner or waves | A short reaction |

- When the conversation on screen finishes, the pet only celebrates briefly and shows no "!". The "!" clears just like the tray entry: open the conversation in the foreground, or open it from the pet, the tray or a notification.
- When the next turn starts within 3 seconds of the previous one (for example, goal mode rounds), the pet keeps working instead of flashing back to idle. A single tool finishing does not change the pet.
- Bubbles show generic text. Conversation titles appear only when "Show conversation and result titles" is on under General → Desktop notifications.

## Using it

- **Drag** the pet to any display. On release it moves back inside that display's usable area; it never stays off screen or covers the menu bar or taskbar, but it can sit right against them. At the top of the screen the bubble shows below the pet.
- **Tuck** it by dragging past the outer left or right edge of the screens: it slides in and leaves part of itself visible. Clicking a tucked pet opens the conversation when it shows "!" or "?", and otherwise pulls it back onto the screen.
- **Right-click** for: open the app, new conversation, pending items, hide pet, pet settings. "Pet settings" opens Settings → Desktop pet directly.
- **Hide pet** (隐藏桌宠) in the tray or context menu turns off the switch in Settings, which shows the same state; choose **Show pet** (显示桌宠) in the tray to turn it back on.
- Clicking or dragging the pet never takes focus from the app you are using. Clicks on transparent parts go to the window underneath. For the exception when a Mac is used through remote desktop, see Known issues below.
- The position is remembered per display. After a display is removed or its resolution or scaling changes, the pet moves back inside the usable area; without its display it returns to the lower right of the main display. "Reset position" in Settings moves it there too.

## Settings

Settings → Desktop pet offers: show the pet, reset position, character, size (50%–200%), status bubbles and napping. Changes apply at once.

`desktop.pet` in `eduwork.jsonc` provides defaults; choices saved in Settings take precedence:

```jsonc
{
  "schemaVersion": 1,
  "desktop": {
    "pet": {
      "enabled": false,         // off by default in the public edition
      "skin": "eduwork-page",   // built in: eduwork-page, eduwork-page-blue, dafeiyu, ecnu-huashi
      "size": 100,              // percent, 50–200 in steps of 10; 100 is about 128 px tall
      "bubbles": true,          // short bubbles when the status changes
      "sleep": true             // nap when you are away or nothing happens for a while
    }
  }
}
```

The pet stores no account or model keys and does not access the network.

## Parts

| Part | Location | Responsibility |
| --- | --- | --- |
| Pet window | `dsh-electron/src/desktop-pet.mjs` | Small transparent, always-on-top, non-focusable window; click-through, dragging, tucking, remembered positions, context menu, away detection |
| Pet plugin | [`dsh-plugins/desktop-pet`](../dsh-plugins/desktop-pet/README_EN.md) | Settings, built-in characters and their validation, the pet page (state and animation), the settings page |
| Conversation status | `dsh-plugins/desktop-services` | The existing notification sync, which also carries a read-only list of running conversations; the rules that create notification items are unchanged |

- The plugin's Host part sends settings to the desktop shell over the authenticated local bridge of `desktop-services`; it never receives the bridge credential.
- The pet page comes from the plugin directory shipped with the product and runs in its own sandboxed session, talking to the shell only through a fixed preload API. The shell serves it only the page files and the selected character; every other path is refused.
- The page receives item kinds, counts and the item key a click opens, never conversation IDs; titles only with title previews on.
- The plugin is inserted only for the Electron desktop client; the web app is unaffected.

## Character packages

A character package is data only: a `skin.json` manifest and images, no scripts or styles. Images may be SVG, PNG or WebP; the built-in characters use SVG and stay sharp when enlarged.

```jsonc
{
  "schemaVersion": 1,
  "id": "eduwork-page",
  "name": { "zh-CN": "小页", "en": "Page" },
  "author": "EduWork contributors",
  "license": "CC-BY-4.0",
  "frame": { "width": 192, "height": 208 },   // canvas size
  "anchors": { "badge": [150, 36] },          // badge position in canvas coordinates
  "animations": {
    "idle":   { "frames": ["idle.svg", "blink.svg"], "fps": 7, "playback": "blink" },
    "think":  { "image": "think.svg" },
    "drag":   { "image": "drag.svg", "motion": "dangle" },
    "react":  { "frames": ["react-1.svg", "react-2.svg", "react-3.svg"], "playback": "once", "frameMs": [140, 260, 700] },
    "work":   { "sheet": "work.png", "frames": 8, "columns": 4, "fps": 10 }
  },
  "states": { "working": ["think", "work"] },
  "lines": { "done": { "zh-CN": ["写好啦，点我看看！"], "en": ["All done! Click me."] } }
}
```

- Three notations become one frame list when loaded: a frame sequence `frames`, a sprite sheet `sheet` (wrapping after `columns`, starting at `row`), or one `image` with a built-in `motion` (`float`, `hop`, `dangle`, `breathe`, `sway`, `shake`).
- `playback`: `loop` (default), `once` (holds the last frame), `pingpong`, `blink` (holds frame 0 and plays the rest once at random moments). `repeat` limits the loops of an inserted action; `frameMs` sets each frame's duration.
- Animation names in use: `idle`, `think`, `work`, `attention`, `done`, `failed`, `sleep`, `drag`, `react`, `peek` (tucked), `greet`. Only `idle` is required; missing ones fall back, for example `done → react → idle`. Built-in characters must provide all of them. The first entry of a `states` list is the resting animation; the others are inserted at random.
- Artwork conventions: frame 0 is the still pose; feet line up and the character keeps the same scale across animations; the character faces left and is mirrored when dragged to the right.
- Safety: SVG needs a `viewBox` and may not contain scripts, `foreignObject`, event attributes, a DOCTYPE or references outside the file. PNG and WebP must match their file headers, at most 4096×4096 each. A package is at most 20 MB, an animation at most 64 frames and 30 fps. Text is shown as plain text only.

The built-in characters live in `dsh-plugins/desktop-pet/skins/`, one directory each; see [`skins/LICENSE`](../dsh-plugins/desktop-pet/skins/LICENSE) for licenses and attribution:

| Character | ID | Source | License |
| --- | --- | --- | --- |
| Page (red, blue) | `eduwork-page`, `eduwork-page-blue` | EduWork contributors, generated by `scripts/build-page-skins.mjs` | CC BY 4.0 |
| Dafeiyu | `dafeiyu` | Character by ZipZipPipe; uses the [whale-girl](https://github.com/vlln/whale-girl) PNG sprites, one sprite sheet per animation | MIT |
| Huashi | `ecnu-huashi` | Early prototype and asset collection contributed by xhan51 ([ECNU/EduWork-ECNU#18](https://github.com/ECNU/EduWork-ECNU/pull/18)); redrawn as SVG by JunieXD and connected to the shared desktop pet framework, generated by `scripts/build-huashi-skin.mjs` | Character and emblem © East China Normal University |

Characters are added and maintained by contributors through pull requests; the app has no import. To add one, put `skin.json` and its images in `skins/<id>/` with every animation listed above, record its source, attribution and license in `skins/LICENSE`, and update the character list in the plugin tests. Built-in characters are validated strictly; a character with missing animations or invalid images is left out.

## Platforms

- macOS: a panel window, shown above other apps' full-screen spaces and below the Dock. With Electron 44 on macOS 27, clicking a panel activates the whole app ([electron#53889](https://github.com/electron/electron/issues/53889)); `prevent-activation.node`, compiled during assembly, turns that off before the window is shown. Remove it once Electron ships the fix.
- Windows: always on top above the taskbar, and raised again periodically so other topmost windows do not cover it.
- Both use forwarded mouse moves plus a cursor read in the main process to decide whether the pointer is on the pet: every 50 ms near the pet, every 0.5 seconds otherwise.
- The page has a single animation clock and stays on one frame most of the time when idle; animation pauses while you are away or the screen is locked. The system "reduce motion" setting is respected.

## Known issues

- **macOS: through remote desktop, pressing the mouse on the pet brings EduWork to the front.** When a tool such as UU Remote controls the Mac, its clicks make macOS 27.0.1 activate the app that owns the clicked window. `prevent-activation.node` above does not stop this, and neither do AppKit's own non-activating panels. Using the Mac's own mouse or trackpad is not affected.
- **Windows touchscreens: the first tap on the pet reaches the window underneath.** The pet window lets clicks through until the pointer is over the pet; a tap has no hover before it, so the first tap passes through to the window below. The pointer then rests on the pet, and further taps there work. Mouse use is not affected.

## Development and verification

```sh
node --test dsh-plugins/desktop-pet/test/*.test.mjs dsh-electron/tests/desktop-pet-core.test.mjs dsh-electron/tests/task-notifications.test.mjs
```

- `dsh-plugins/desktop-pet/test/host.test.mjs` needs `EDUWORK_TEST_RUNTIME` set to a verified Runtime's `d` directory.
- Real Electron checks (window properties, file access, IPC origin, processes after hiding and closing): `EDUWORK_TEST_EVIDENCE=<new directory> <Electron executable> dsh-electron/tests/desktop-pet.electron.mjs`.
- Click-through, focus, full-screen spaces, real-pointer dragging and tucking, multiple displays and long idle power use need native acceptance on both platforms' release packages.
