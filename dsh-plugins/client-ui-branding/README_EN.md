# Client branding and color themes

[简体中文](README.md)

A removable DSH client plugin using official Sidebar/hero slots and `theme.overrideTokens`. The public default is neutral EduWork blue; branding does not enable institution services.

```yaml
product:
  name: EduWork
  logoUrl: ''
  styleLabels:
    dsh: Blue
    ecnu-liwa: Red
visualStyle: dsh
```

Logo URLs support same-origin paths, HTTP(S) and image data URLs, not arbitrary local file paths. Product identity is read from `composition.base.product` rather than stale user branding settings; `visualStyle` remains a user preference. Existing namespace and style IDs remain for compatibility.

One global color setting applies across plugins. `src/theme.js` contains `COLOR_SCHEME_TOKENS` and `RED_TOKENS`; blue values may be null to inherit official tokens. The plugin reuses the official settings entry without replacing upstream theme management.

Build with `build-client.ps1 -Upstream <source> -DshLockPath <lock> -Output <directory>`. The script uses the locked source with a temporary extension under `packages/extensions` and cleans it afterward. Do not run competing builds against the same upstream workspace.
