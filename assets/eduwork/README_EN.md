# EduWork brand assets

[简体中文](README.md)

`mark.svg` is the vector master: a folded E representing the path from information to an outcome. The white mark remains consistent. Public and institution editions share red application icons by default. Users can still choose the blue interface theme, and saved preferences are preserved. `icon.svg`, all PNG sizes, ICO and ICNS use red; `icon-blue.svg` retains the blue variant.

`product.logoFile` can replace the interface logo through configuration. It does not change the application's executable identity.

Generate PNG, multi-resolution ICO, ICNS and tray assets with:

```sh
node scripts/build-eduwork-icons.mjs --sharp <sharp-module-entry>
```

The build script defines the output paths. macOS assembly uses the same red ICNS and PNG assets; complete platform support still requires the checks in the [macOS guide](../../docs/MACOS.md). These assets are MIT licensed.
