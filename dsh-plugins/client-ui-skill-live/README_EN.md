# ChatECNU Work live Skill UI

[简体中文](README.md)

This compatibility plugin replaces the locked DSH `ui-skill` row. It preserves
the official `/` Skill menu and tool presentation, and adds one behavior: a
change to `chatecnu-skills` clears the per-session Skill catalog cache so the
menu immediately reflects a user's enable/disable choice.

`build-client.ps1` derives the browser module from the locked upstream MIT
artifact without changing the official package. See `UPSTREAM.md` for origin
and the intentionally narrow delta.
