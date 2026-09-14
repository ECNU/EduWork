# DSH 0.1.5-rc.2 dependency lock

[简体中文](README.md)

`LOCK.json` records the selected upstream source, Node/npm versions and verification hashes. Official npm dependencies are pinned in `npm-runtime/package-lock.json`.

`DSH-CONTRACT-SNAPSHOT.json` records exported interfaces, files and type hashes for contract checks. Required compiler compatibility patches apply only to temporary build directories, without changing official source files. Retained rc.1 provenance describes dependency origins, not the current default baseline.

The product defaults to rc.2 and manages its own version separately from DSH. Electron is the regular desktop distribution; Go provides the upgrade transition. Both shells share the product runtime. See [Electron integration](../../../dsh-electron/README_EN.md).
