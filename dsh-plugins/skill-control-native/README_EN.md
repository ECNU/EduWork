# ChatECNU Work DSH skill control

[简体中文](README.md)

This Agent-plane plugin replaces DSH's ordinary filesystem Skill provider with
a thin policy wrapper around the upstream `FileSystemSkillProvider`. The
durable policy namespace is registered once by the Host-plane sibling package
`@chatecnu-work/dsh-skill-settings-native`.

- project, user, and bundled discovery still use DSH's parser, precedence,
  watcher, resource-base, and scope semantics;
- disabled Skill names live in the normal DSH settings document and can be
  maintained before a project/session exists;
- a Skill carrying `metadata.chatecnu.credentialRef` is omitted while that
  credential is not configured;
- new skills use `metadata.eduwork.credentialRef`; the legacy metadata spelling remains compatible. Institution-bound skills can also declare `oidcProfileId` and `runtimeBaseURL` in that section. A populated shared key alone does not expose a skill belonging to a different signed-in institution;
- `metadata.artifact.capability: image-generation` follows the shared image
  provider registry's actual availability, independently of any institution;
- legacy product setting names map to their `artifact-*` successors. The UI
  and this provider share the same pure preference policy;
- changes invalidate the DSH Skill catalog in memory. No Skill directory is
  copied, renamed, deleted, or rescanned by application-specific code.

Shared artifact services are an optional Cordis dependency. The image gate
tracks service attachment, replacement and removal, plus provider-change
notifications; an answer from an unloaded provider cannot re-enable the skill.
Credential invalidation follows DSH's `credentials/reference-updated` event,
with `credentials/updated` retained for older providers.

`test/host.test.js` mounts the plugin through real Cordis and the DSH 0.1.5
Skill registry, rather than calling `apply()` on a root context. Set
`CHATECNU_TEST_RUNTIME` to an inspected 0.1.5-rc.1 Runtime closure when it
is not available in this checkout's development Runtime directory. It uses
isolated synthetic skills and credentials; it makes no remote model requests.

The package is mounted once per Agent preset so each preset keeps DSH's native
scope boundary.

The current desktop assembly copies shared artifact and configurable Studio
skills into this one managed root, while setting their package registrations
to `skills:false`. Older Studio packages retain their own runtime registration
when they cannot opt out; the assembler must not also copy that skill.
