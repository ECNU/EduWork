# DSH 0.2.0 and EduWork 0.4.0

[中文](CORE-020.md)

This combination pins DSH `0.2.0-rc.1`, commit `4878cdabd87d4041bdaff61d04c966883b9fd07a`. Official npm dependencies and desktop sources are verified separately using `third_party/dsh/candidate-v0.2.0-rc.1/`. Historical `017` script names remain compatible with existing automation; the previous npm release lock is retained.

## Distribution policy

- Official product analytics, session-log and plugin-inventory uploads, feedback controls and `/feedback` are disabled through the official `runProfile.patchFiles` overlay. The policy survives user preferences and reloads. Native DeepSeek request identifiers remain unchanged.
- Scheduling uses the official optional plugin, disabled by default and available from the plugin page. Existing activation, settings and task storage are preserved. Tasks do not run while the app is closed or wake the computer.
- File reveal uses the official native opener. Product extensions continue to provide attachment cards, organization login, Studio and skill management.
- Literature uses the EduWork-maintained [`@eduwork/dsh-literature`](../packages/dsh-literature/README_EN.md), forked from SihanLv/dsh-literature 0.1.2. Jobs compatibility is implemented in source without bypassing official compatibility checks. Candidate dependencies remove the old `@shlv` family while retaining DBLP, arXiv, citations, full text and user activation settings.

## Updates and data

`0.4.0` uses the stable update channel even with an RC kernel and a public-beta badge. On first upgrade, users who inherited a dev default move to stable; explicit dev choices are preserved. A separate migration receipt protects later user choices. Pending dev installations are cancelled, while caches and content revision floors remain intact.

On macOS, the first stable launch reuses Alpha data if no stable data directory already exists. Two existing directories are never merged automatically. Windows keeps its current data locations. Configuration, credentials and sessions are not reset.

Older Alpha packages disabled automatic updates without recording whether that was a package default or a later user choice. Such configurations receive a one-time choice to enable updates or keep them disabled. The prompt requires an available packaged update source: the selected Sparkle channel on macOS, or validated publisher bootstrap settings for institution editions. Existing custom update addresses are preserved.

## Assembly

The desktop workflow's explicit `source_stable` mode builds `0.4.0` using the pinned official npm Runtime and product plugins rebuilt from that commit, retaining receipts and software updates. `source_alpha` continues to require a development version and disables automatic updates; the modes are mutually exclusive. Stable macOS assembly requires trusted Sparkle configuration. Publication still requires main, both successful platforms and approved version-specific notes, with verification and upload performed in CI.

Institution editions must update their signed configuration for `0.2.0-rc.1`; changing a version string cannot replace a compatible signed release. School connection configuration and internal feedback API drafts are not included in this repository.
