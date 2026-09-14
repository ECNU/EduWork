# Component inventory service

[简体中文](README.md)

Reads the assembled `release.json` to report the product, platform, runtime and media-component versions and readiness. Opening the inventory never installs software or downloads resources.

The official DSH plugin inventory owns loader and plugin-instance status. This service reports product components without duplicating that inventory.
