# Desktop release gates

The source snapshot targets DSH `0.1.5-rc.2`. Both portable Windows candidates
consume one frozen product. Regular GitHub desktop Releases will package
Electron for qualified platforms and both editions. Temporary desktop builds
and Go/Wails transition packages are built and verified locally, outside the
GitHub packaging matrix. CI checks source, locked dependencies and builds. The manually authorized
release-windows.yml builds a Windows Electron ZIP, checks its extracted contents
and runs a launch smoke check before publishing. Full Web, OIDC/restart, Office
and media integration tests are local pre-submission checks; they are not
repeated as release-CI gates. The receipt states its actual CI scope.

Before dispatching a desktop Release job:

- Follow `docs/RELEASE.md`: internal versions are `X.Y.Z-dev.YYYYMMDD.N`,
  never Releases. Publish only `X.Y.Z`; while DSH is a prerelease, the product
  UI says public beta. Preserve old update formats for the Go transition.
- Match the actual packaged version and both language badges. Verify persisted
  development/public channel selection, no downgrade, stable refusing developer
  artifacts, and the blue update action plus checking/download progress. Test
  the default total model-request limit of 3 across main and child agents and queue cancellation.

- Run the Web build from a clean clone, then prepare the common product and
  Electron shell using the recipe in `dsh-electron/README.md`. Keep Wails source
  regression checks; no temporary Wails packaging job is required on GitHub.
- Before offering this release to old ECNU installations, attach local evidence
  of the shipped old package upgrading to the Go transition package, retaining
  history and recovering from failure. The independent Wails candidate is not
  yet that transition package. Preserve the legacy feeds outside GitHub Release
  automation; do not deliver an Electron ZIP to an unqualified old updater.
- Freeze the native resource inputs, preserve each resource's license, verify
  their hashes, and run Office/media creation, preview and download tests.
- Test the actual packaged Windows applications: initial setup, full OIDC flow,
  account menu/quota/logout, model selection, uploads, window/tray behavior,
  configuration changes, moving the portable directory and isolated data.
- Record public and institutional defaults separately. The institution release
  must pin a public core commit and use its build scripts, without copying them.
- Follow [update-source requirements](docs/UPDATES.md). Windows has a shared
  portable updater, but an unconfigured candidate has no online feed. The CI
  new-install ZIP is not yet the update-contract ZIP. Qualify GitHub discovery,
  package format and real updates before enabling that channel; do not equate
  a successful Release upload with working automatic updates or code signing.
- Publish only reviewed archives and checksums. Public distribution uses GitHub
  Releases; an institution may add its own mirror through its edition workflow.

macOS and optional on-demand local language models are not qualified by these
Windows source tests. Do not publish those assets without their own acceptance.
