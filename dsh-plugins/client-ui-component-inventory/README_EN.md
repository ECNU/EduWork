# About and community plugin interface

[简体中文](README.md)

Adds a dedicated About page through `settings.section`, shared by public and institution editions. It displays the product name and version once, followed by Electron, DSH Core, Node.js, Python and capability environments with versions, sources and readiness. Legacy platform receipts remain readable without a duplicate product version card.

The `settings.about.brand` child slot reuses the existing brand component. GitHub links to the public repository. Report an issue opens the public issue template in the system browser, prefilling only the product name, version, platform and DSH Core version. Logs, paths, configuration and credentials are not attached. The repository also provides a feature request template.

The official plugin list still owns Loader plugins, enablement and Fiber lifecycle, and plugin configuration stays in its existing page. Desktop compositions with an available community-plugin management service expose a separate Community plugins tab for install, update, remove and restart actions. The default composition does not ship that backend, so the tab stays hidden; About works independently. Web compositions show source runtime information and omit these native operations without requiring a desktop bridge.

Build with `build-client.ps1`, supplying `-Upstream`, `-DshLockPath` and `-Output` for the locked DSH source.
