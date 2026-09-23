# DSH 0.1.7-alpha.2 migration candidate

[简体中文](README.md)

This directory pins upstream source and npm Runtime inputs for migration checks. **It is not a qualified desktop baseline.** Default builds still use `release-v0.1.5-rc.2`. Do not replace an installed EduWork Runtime or an existing user's data with this candidate.

- Upstream commit: `00102833dfaee1da9f48a3a8eae9d34005a75218`, tagged `dsh-v0.1.7-alpha.2`.
- `LOCK.json` records source archive, pnpm lock, npm install lock and package integrity. Runtime packages come from the official npm registry, with one pinned DSH family version.
- Only the published npm Runtime is enabled. Source packing remains disabled; existing product plugin npm locks are unchanged.
- The desktop Host, settings service, Agent presets and product plugins still require migration. A successful candidate installation does not establish EduWork compatibility.

Prepare a separate Runtime from the repository root. The output directory must not exist:

```powershell
node dsh-desktop/scripts/prepare-dsh-runtime.mjs --source npm --lock third_party/dsh/candidate-v0.1.7-alpha.2/LOCK.json --output C:/EduworkTest/runtime-017
```

Run the real upstream service and synthetic migration probe (Windows, macOS and Linux; adjust paths for your platform):

```powershell
node scripts/probe-dsh-017.mjs --runtime C:/EduworkTest/runtime-017 --output C:/EduworkTest/probe-017
```

The probe verifies the installation receipt and creates a new DSH home. It checks local Web authentication, services including settings and presets, read-only V3 migration, V4 successor publication, extension preservation, and refusal of corrupt logs. The output's `report.json` contains the results. Keep the directory for inspection and use a new directory for another run. Upstream startup logs can contain a local authentication URL; do not post raw logs to public issues.

These checks do not cover live model requests, organization sign-in, Studio, native windows, preview rendering or application updates, and do not establish compatibility with every historical session. Complete those acceptance checks before promoting the desktop release baseline.
