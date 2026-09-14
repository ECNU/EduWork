# Upstream and reference notes

- Version 0.1.1 baseline: `0.1.5-rc.1`; the previous 0.1.0 package used `0.1.2-rc.1`.
- Host/client integration uses public DSH services only: storage domain,
  session query, settings, tools, commands, agent pre-step, Remote, locale, and
  settings slots. Prior-chat retrieval uses DSH's own derived search index and
  canonical session-reference format rather than maintaining another archive.
- `dsh-agent-memory` by Culeot (MIT, reviewed at commit
  `af709743fb267b536d11343bab43e9a54f96367c`) informed the storage-domain,
  scope, CJK tokenization, and explainable-recall design. This package is a new
  implementation and does not vendor that package or its dependencies.
- Codex Memory behavior and user-facing names were checked against official
  OpenAI documentation. Codex's private ranking and generation implementation
  is not copied; this plugin implements independently designed controls over DSH's
  public extension seams.

The plugin must remain removable and institution-neutral. Institution account,
provider, branding, and cloud synchronization logic do not belong here.
