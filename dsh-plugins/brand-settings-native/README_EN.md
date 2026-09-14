# EduWork brand settings

[简体中文](README.md)

The desktop bundle may also set `upstreamWelcomeNoticeVersion` to the exact
DSH notice version reviewed by the product. The Host then records that version
through DSH's public `ui-onboarding` settings namespace before the Web client
boots. This suppresses the Harness-developer notice without forking its UI or
changing plain Web `dsh-oidc` behavior. Omitting the field retains native DSH
onboarding.

This Host-plane plugin owns the durable `chatecnu-brand` settings namespace
and the desktop product's narrow upstream-onboarding policy. The DSH theme runtime remains authoritative for light, dark and
system color-scheme behavior; this namespace stores the orthogonal visual
style family selected by the user and the last details-panel width. The width
is stored through DSH settings instead of browser localStorage because the
desktop loopback origin uses a new random port on each launch.

Removing the plugin and the corresponding Client branding plugin restores the
upstream DSH visual style without migrating sessions or workspace data.

The same namespace records which optional product Agent presets are enabled.
Synchronization is checked against `ctx.agentPresets.roots`, the official DSH
roster service, rather than assuming that an environment path is what DSH
actually scans. DSH 0.1.2-rc.1 reapplies its CLI-adjacent preset root after
all downstream bundle patches, so the Windows assembly carries one audited,
fail-closed compatibility substitution that lets the launcher-owned absolute
`DSH_PRODUCT_PRESET_DIR` replace that root. Remove the substitution as soon as
upstream exposes an equivalent product preset-root seam.


## Edition identity and local Web

The `product` composition option accepts `{ name, logoUrl, styleLabels }`.
Its default is neutral EduWork; institution assemblies supply their own name,
logo asset and style names. The Client reads the composition base for identity,
and the resolved user layer for `visualStyle` and panel width. Display names do
not select model providers, authentication, speech or other capabilities.

The stored namespace `chatecnu-brand` and red-style id `ecnu-liwa` remain stable
for existing users. A new profile defaults to blue (`dsh`); an existing explicit
red preference is preserved. An institution can supply a red composition default.

No desktop bridge is required. In local Web, omit the two product preset root
environment variables to use the official roster. Optional-preset file sync runs
only when either root is declared or `manageOptionalPresets: true` is supplied;
then both absolute roots and the matching official roster are required. Explicit
`manageOptionalPresets: false` disables this policy. The branding and persistent
preferences remain available in all three modes.
