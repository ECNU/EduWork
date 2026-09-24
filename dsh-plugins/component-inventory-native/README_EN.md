# Component inventory service

[简体中文](README.md)

Reads `assembly.json` and `desktop-resources.json` to report component versions and readiness, with a fallback for legacy `release.json` receipts. Product identity comes from the current edition; the running Electron process passes its framework version to the Node Host instead of reusing the product version. Opening About never installs software or downloads resources.

The official DSH plugin inventory owns loader and plugin-instance status. This service reports product components without duplicating that inventory.
