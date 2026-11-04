# EduWork extensions entry

[中文](README.md)

Adds an **EduWork extensions** tab to the native DSH Plugins page for annotations, side chat, literature, mail, remote access and external agents. Only packages available in the current installation are shown.

Disabling unloads the plugin's services and UI while retaining configuration and data. Enabling restores access. Mail retrieval and remote connections still have their own settings; loading a plugin does not automatically enable these services.

## Boundaries

- The product provides this entry independently of the managed bundles, so disabling an extension does not remove its enable switch.
- Native `listBundles` / `setBundleEnabled` manage whole bundles. DSH owns compatibility checks, authorization, persistence and hot reload. The UI reports failures and required restarts rather than assuming the plugin is running.
- `lib/catalog.js` contains only identity, localized copy, guide links and first-install defaults. Product assembly requires an exact published npm lock; an unpublished source package is not assembled into a release.
- Existing features load by default; external agents are opt-in. Editions can set initial boolean defaults by npm name through `extensionDefaults`; see the [build guide](../../docs/BUILD.md). Defaults initialize new features only. Existing selections survive restarts, upgrades and changes to edition defaults.
- Mail and literature become optional bundles, preserving existing native bundle selections. User choices still go to the native DSH profile manifest, not a separate preference store.
- Organization sign-in and Memory stay built in: the former provides organization identity and models, while the latter also configures shared storage and history search. They are outside this optional catalog and cannot be overridden through `extensionDefaults`.
- Desktop pet stays built in with its existing Settings and tray visibility controls. Shell windows, tray actions and settings links do not yet follow plugin unloading, so no disable switch is offered here.
- Knowledge Studio, decision tools and artifact services retain their existing assembly and stay outside this optional catalog. The product loads Studio and artifact Skills centrally; the decision plugin registers its Skill when its service is enabled. Future switches must coordinate tools, Skill discovery, menus and saved user preferences.
- Shared artifact services, notifications, permissions and credential storage do not receive independent switches. Annotations and side chat can be toggled independently.
- This page does not install external CLIs, start agents, manage credentials or change task permissions.

## Plugin settings

An enabled plugin can register a keyed component in `eduwork.extensions.config` through the official Slot API, using its npm package name as the key. Normal `renderSlot` ownership and disposal apply. The same form can register in native `plugins.bundle.config` for standalone DSH installations and remain available in Settings. Plugins without this Slot keep their existing settings entry; no empty Configure button is shown.

New catalog entries require publication and a verified package lock, plus checks of disabled defaults, toggling, restart, existing user preferences and form disposal. This product UI is added only by the current 0.2.1 build pipeline, not the legacy runtime lane.
