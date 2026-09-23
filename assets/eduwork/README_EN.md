# EduWork brand assets

[简体中文](README.md)

`mark.svg` is the vector master: a folded E representing the path from information to an outcome. The white mark remains consistent. Public and institution editions share red application icons by default. Users can still choose the blue interface theme, and saved preferences are preserved. `icon.svg`, the `icon-<size>.png` files, ICO and ICNS use red; `icon-blue.svg` and `icon-blue-1024.png` provide the blue variant.

`product.logoFile` can replace the interface logo through configuration. It does not change the application's executable identity.

Generate PNG, multi-resolution ICO, ICNS and tray assets with:

```sh
node scripts/build-eduwork-icons.mjs --sharp <sharp-module-entry>
```

The build script defines the output paths. macOS keeps the red installed ICNS icon; the running Dock icon and startup window follow the selected color scheme. The Dock uses `dock-red-1024.png` and `dock-blue-1024.png`, with 100 pixels of transparent padding on each side of the 1024-pixel canvas; in-app logos keep their original size; complete platform support still requires the checks in the [macOS guide](../../docs/MACOS.md). These assets are MIT licensed.
