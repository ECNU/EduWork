# ChatECNU Work DSH skill settings

[简体中文](README.md)

This Host-plane plugin owns the durable `chatecnu-skills` settings namespace.
It is mounted once in the desktop composition, so the native settings UI can
enable or disable Skills even before a project or Agent session exists.

The package owns policy state only. Skill discovery and filtering remain in the
Agent-plane `@chatecnu-work/dsh-skill-control-native` provider.
