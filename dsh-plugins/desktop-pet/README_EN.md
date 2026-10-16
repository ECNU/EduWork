# Desktop pet

[简体中文](README.md)

The desktop pet plugin for the EduWork desktop client: a small pet on the desktop that follows your conversations and opens the one that needs you or has finished when clicked. See [Desktop pet](../../docs/DESKTOP_PET_EN.md) for usage, states and the character package format.

![Page](skins/eduwork-page/idle.svg)

## Parts

- **Host part** (`lib/index.js`): service `desktopPet`, depends on `desktop-services`. Keeps five settings: enabled, character, size, bubbles and napping (`desktop.pet` in `eduwork.jsonc` provides defaults; choices saved in Settings take precedence). Validates the built-in characters strictly, tells the desktop shell about changes through `desktopServices.pet()`, and closes the pet when the plugin stops. Remote methods: `status()` returns whether the pet is supported and the characters with previews; `resetPosition()` moves the pet back to its default place.
- **Shared modules**: `lib/skin.js` validates manifests and turns the three animation notations into frame lists; `lib/pet-state.js` decides state priority, pacing and frame timing. Both are used by the Host and the pet page, depend on neither Node nor the DOM, and take time and randomness from the caller.
- **Pet page** (`lib/page/`): loaded by the desktop shell in its own sandboxed window; plays the character, decides what to show and hit-tests clicks by pixel.
- **Settings page** (`src/client.js`): registers the Desktop pet page in `settings.section`.
- **Built-in characters** (`skins/`): Page (red and blue), Dafeiyu and Huashi; see [Desktop pet](../../docs/DESKTOP_PET_EN.md#character-packages) for sources and licenses.

The window itself (transparent, always on top, click-through, dragging, tucking, remembered positions) belongs to the Electron shell; see `dsh-electron/src/desktop-pet.mjs`. Only the Electron desktop product inserts this plugin; elsewhere, without a desktop shell, the settings page reports that the pet is not supported.

## Changing the built-in characters

Page and Huashi are generated: edit `scripts/build-page-skins.mjs` or `scripts/build-huashi-skin.mjs`, then run:

```sh
npm run build:skins
```

The tests check that these characters match the generator output exactly, so do not edit their SVG files by hand. Dafeiyu uses the whale-girl PNG sprites; see `skins/LICENSE` for their source.

## Verification

```sh
node --test test/*.test.mjs
```

`test/host.test.mjs` needs `EDUWORK_TEST_RUNTIME` set to a verified Runtime's `d` directory; the other tests need no Runtime.

## License

The code is MIT licensed (see [LICENSE](LICENSE)). See [skins/LICENSE](skins/LICENSE) for each character's artwork license and attribution.
