# Third-party notices

EduWork combines independent components; its MIT License applies only to project code. Keep each dependency's license and provenance metadata when building a validation artifact or desktop package.

- Default DeepSeek Harness assembly is pinned by `third_party/dsh/release-v0.1.5-rc.1/LOCK.json` and its adjacent npm package lock. Official runtime packages are fetched from npm with integrity checks. Their MIT license and upstream notices remain in the distributed runtime. The distribution projection removes unused external-agent/debug payloads; its receipt records all changes.
- DSH's desktop Host is not published on npm for this baseline. Its adapter and local client extensions use the pinned official source commit. Explicit DSH source development builds use `third_party/dsh/development-v0.1.5-rc.1/LOCK.json` and reviewed build normalization: CSS identities use repository-relative paths and pnpm's packing hook sorts dependency maps after workspace resolution. `exports` conditions and runtime semantics keep their order. The archive retains its original SHA-256; the derived source build records the exact before/after hashes. Derived builds must not be described as unmodified official npm bytes.
- Independent OIDC, Mail, Memory, Studio and Artifact Services packages retain their own source provenance and licenses. Exact versions and hashes are in the package locks and assembly receipt.
- Node.js, Python, browser binaries, office libraries, speech engines and model weights have their own notices and redistribution terms. Keep the notice files alongside actual packaged resources.
- Remotion uses its own license with eligibility and usage conditions. Including its source or runtime does not make it MIT licensed. Review the applicable upstream terms for the actual distributor and deployment.

The file-level source receipt does not substitute for a dependency SBOM. Final desktop releases must include a complete SBOM and applicable runtime/model/media notices; desktop release preparation is a later stage.
