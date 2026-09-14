# Upstream provenance

- Package: `@deepseek-ai/dsh-client-ui-agent-preset`
- Version: `0.1.2-rc.1`
- Commit: `a66e4702047846cdaa10c66c9d3df3951f5ea70d`
- Approved source: locked npm Runtime or
  `.research/upstream/deepseek-harness/packages/client/ui-agent-preset/lib`

`build-client.ps1` verifies and copies the locked official artifacts, rebinds package
identity, and applies anchor-checked changes limited to optional-preset display
and switching. Any upstream anchor change fails the build.
