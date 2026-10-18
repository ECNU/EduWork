# Search settings adapter

[简体中文](README.md)

Reuses the official DSH settings form. Switching Search / Fetch API off restores the deployment defaults. The upstream controller owns endpoints, credentials and save behavior.

The build derives its client from the pinned upstream package and checks every modified anchor. Retire this adapter when upstream restores deployment defaults.
