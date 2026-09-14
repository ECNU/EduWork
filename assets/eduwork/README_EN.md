# EduWork brand assets

[简体中文](README.md)

`mark.svg` is the vector master: a folded E representing the path from information to an outcome. The white mark remains consistent; the default background is blue, and the red theme changes its background color.

`product.logoFile` can replace the interface logo through configuration. It does not change the application's executable identity.

Generate PNG, multi-resolution ICO, ICNS and tray assets with:

```sh
node scripts/build-eduwork-icons.mjs --sharp <sharp-module-entry>
```

The build script defines the output paths. An ICNS asset alone does not establish macOS packaging support. These assets are MIT licensed.
