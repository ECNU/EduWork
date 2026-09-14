# ChatECNU Work Agent Presets UI derivative

[简体中文](README.md)

This compatibility package preserves DSH's official Agent Presets controllers,
roster, settings section, General row, new-session seat and session label. It
adds the product policy DSH rc2 does not model yet: `minimal` and `cordis` remain
visible in the management page while disabled and can be enabled there.

Enabled presets are still discovered and selected by the official
`@deepseek-ai/dsh-agent-presets` host service. The product switch only updates
`chatecnu-brand.enabledOptionalPresets`; the native product settings plugin
synchronizes the corresponding shipped preset directory into the official
discovery root.
