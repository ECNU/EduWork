# EduWork extensions entry

[中文](README.md)

Adds an **EduWork extensions** tab to the native DSH Plugins page for viewing, enabling, disabling and configuring optional bundled packages. External agents is the first catalog entry. Only packages available in the current installation are shown.

## Boundaries

- The product provides this entry independently of the managed bundles, so disabling an extension does not remove its enable switch.
- Native `listBundles` / `setBundleEnabled` own state, compatibility checks, authorization, persistence and hot reload. The UI reports failures and required restarts rather than assuming the plugin is running.
- `lib/catalog.js` contains only identity, localized copy, guide links and first-install defaults. Product assembly requires an exact published npm lock; an unpublished source package is not assembled into a release.
- `disabledByDefaultBundles` is a subset of `optionalBundles` and controls first-install activation. Existing user selections survive restarts and upgrades. Defaults for existing optional bundles remain unchanged.
- This page does not install external CLIs, start agents, manage credentials or change task permissions.

## Plugin settings

An enabled plugin can register a keyed component in `eduwork.extensions.config` through the official Slot API, using its npm package name as the key. Normal `renderSlot` ownership and disposal apply. The same form can register in native `plugins.bundle.config` for standalone DSH installations and remain available in Settings.

New catalog entries require publication and a verified package lock, plus checks of disabled defaults, toggling, restart, existing user preferences and form disposal. This product UI is added only by the current 0.2.1 build pipeline, not the legacy runtime lane.
