# Package development and publication

[简体中文](PACKAGES.md) | **English**

EduWork maintains its public plugins in one source repository. Each npm package retains its identity, version and independent installation/publication. Issues, PRs, protocols and development documentation belong to `ECNU/EduWork`; institutional implementations remain in EduWork-ECNU. Each plugin documents its host requirements. The desktop pet requires the EduWork Electron desktop bridge; other DSH clients must integrate that interface first.

| npm package | Source and documentation | Installation root |
| --- | --- | --- |
| `@eduwork/dsh-annotation` | [Selection quotes and notes](../packages/dsh-annotation/README_EN.md) | `packages/dsh-annotation` |
| `@eduwork/dsh-desktop-pet` | [Desktop pet and host requirements](../packages/dsh-desktop-pet/README_EN.md) | `packages/dsh-desktop-pet` |
| `@eduwork/dsh-literature` | [Literature search, citations and full text](../packages/dsh-literature/README_EN.md) | `packages/dsh-literature` |
| `@eduwork/dsh-oidc` | [Identity, credentials and models](../packages/dsh-oidc/README_EN.md) | `packages/dsh-oidc` |
| `@eduwork/dsh-memory` | [Local memory and retrieval](../packages/dsh-memory/README_EN.md) | `packages/dsh-memory` |
| `@eduwork/dsh-mail` | [Mail assistant](../packages/dsh-mail/README_EN.md) | `packages/dsh-mail` |
| `@eduwork/dsh-knowledge-studio` | [Studio](../packages/dsh-knowledge-studio/README_EN.md) | `packages/dsh-knowledge-studio` |
| `@eduwork/dsh-artifact-services` | [Office, speech, images and media](../packages/dsh-knowledge-studio/packages/artifact-services/README_EN.md) | Studio's existing workspace |

Seven development roots retain their own dependency locks without repository-wide hoisting. Studio keeps its existing `packages/artifact-services` workspace; each package still produces its own tarball. Other packages communicate through public npm exports, not relative imports into another package's implementation.

## Develop and check

Use each manifest and lock for Node/DSH requirements; common CI uses Node 24.22.1. From the repository root:

```sh
node scripts/packages/manage.mjs list
node scripts/packages/manage.mjs install dsh-oidc
node scripts/packages/manage.mjs check dsh-oidc
node scripts/packages/manage.mjs pack dsh-oidc
```

Existing commands also work from each development root. Run `check` before `pack`; packaging deliberately uses already-built files. Outputs under `dist/npm-packages/<id>/` include the archive, file list, version, source commit, dirty-source flag and checksums. Select `dsh-artifact-services` for shared services; its checks cover Studio as well.

Studio/shared-service Node tests generate real Office files. Prepare a separate Python 3.12+ environment, run `python -m pip install -r packages/dsh-knowledge-studio/packages/artifact-services/python/requirements.txt` and set `DSH_OFFICE_PYTHON` to that interpreter's absolute path. CI performs this setup automatically, without a browser or enterprise login.

CI selects affected development roots; shared-service changes also select Studio. Markdown/image-only changes run documentation and entry-point checks. Browser, real login/mail, Office and media acceptance remain targeted local work for relevant behavior changes. Ordinary CI does not install browsers, call real models or publish packages/desktop Releases.

## Publish independently

`@eduwork/dsh-literature` targets the DSH `0.2` API series, forked from `SihanLv/dsh-literature` and maintained by EduWork. The 0.2 candidate installs the published npm version selected by the component lock, with its version, integrity, tarball SHA-256 and source commit recorded in `third_party/dsh/candidate-v0.2.1-rc.2/literature.json`. Source assembly does not overwrite this package. Historical builds retain the original `@shlv/dsh-literature` lock.

Each package keeps its own SemVer, public exports, configuration IDs and persisted paths. Use a new version for every publication; never overwrite an existing npm version. If shared services change version, update Studio's exact dependency and lock; publish and verify shared services before Studio.

Use **Package npm module**, `.github/workflows/packages-release.yml`. Select one package. The default `publish=false` builds, tests and packages without publishing. Plugins publish only to npm, without plugin GitHub Releases or Git tags. GitHub release entries are reserved for desktop client versions.

1. Review the package version, changelog and relevant local acceptance, then commit source and locks.
2. Merge and push the reviewed changes to `main`, then record the full 40-character commit SHA intended for publication.
3. Select `main` as the **Run workflow** source, enter that SHA in `source_commit`, select the package and set `publish=true`. The workflow pins the triggering commit; a mismatch with the supplied SHA stops publication so the source can be reviewed again. Use `latest` for stable versions and `dev` for prereleases. Product versions do not control package versions.
4. CI publishes the checked archive from the same run, verifying its source, identity and hashes without rebuilding or lifecycle scripts. Verify the resulting npm version, integrity and provenance before updating product locks.

Configure Trusted publishing on **each npm package**: GitHub Actions, organization `ECNU`, repository `EduWork`, workflow `packages-release.yml`, environment `npm`. The binding and package repository URL must match GitHub's canonical `ECNU/EduWork` casing; npm provenance verification is case-sensitive. The GitHub environment has the same name. The provenance-based publication path requires a public repository and a valid binding. Use `publish=false` to check and package without publishing. See [npm's requirements](https://docs.npmjs.com/trusted-publishers/).

Maintainers can inspect a binding with `npm trust list @eduwork/dsh-oidc --json`, substituting the other package names as needed. To change the repository, workflow or environment, inspect existing bindings first, create the replacement and remove only the matching obsolete binding. Preserve other valid publishers. npm may require account verification in the system browser.

Do not store long-lived npm tokens. If publication is explicitly authorized before CI publication is verified, a maintainer can publish an inspected archive with an authenticated npm CLI and interactive verification, without claiming GitHub provenance.

## Compatibility declarations and build locks

`peerDependencies` describes supported host APIs. Development dependencies, `package-lock.json` and product locks identify exact build inputs. For a verified compatible API series, prefer a bounded peer range over enumerating every rc version. Check prerelease matching and exercise actual plugin loading and tool calls across the supported range; adjacent versions alone do not establish compatibility, and `*` is not a substitute for a boundary.

Reuse an existing npm archive when its declared range covers a kernel upgrade and compatibility checks pass. Correcting an overly narrow published declaration still requires a new npm version because published versions are immutable, but this should not become a routine step for every rc update. Literature `0.1.2` declares `>=0.2.0-rc.1 <0.3.0-0` without changing retrieval behavior.

Desktop-specific extensions are still built during assembly; their adaptation only qualifies that product build. Independently published plugins use npm artifacts without rebuilding their clients, rewriting peers or modifying bundles. Each package maintains its compatibility range through its own release workflow.

## Product assembly

`@eduwork/dsh-desktop-pet` is installed from its published npm version. `third_party/dsh/candidate-v0.2.1-rc.2/desktop-pet.json` records its version, source commit, integrity and tarball SHA-256; the adjacent `source-probe/package-lock.json` pins installation. The product keeps the shell's floating-window support but never overwrites this package from workspace source or rebuilds its settings client. Publish and verify the plugin before updating the product lock.


The current DSH 0.2.1 recipe installs seven independent packages from npm: desktop pet, literature, mail, memory, OIDC, Studio and shared services. Selection annotations are not assembled into the client; users install them on the Plugins page. Per-package JSON locks under `third_party/dsh/candidate-v0.2.1-rc.2/` record versions, source commits, tarball SHA-256 and npm integrity; `source-probe/package.json` and `package-lock.json` pin installation. The retained `source-probe` directory name does not imply installing plugin source.

Assembly validates the npm inputs before building product-owned extensions. Media templates, the PDF runtime, plugin clients and bundled skills come from published packages. Nothing under `packages/` overwrites them. `assembly.json` distinguishes `externalPackages` from `sourcePackages` and records package file hashes, checked after assembly and edition preparation. Missing packages, inconsistent locks or workspace links fail without a source fallback.

Top-level dependencies shared with the DSH Runtime must have identical versions and integrity. npm nests incompatible transitive versions beneath their consumers. Assembly checks this constraint so merging directories cannot silently change a plugin dependency. The complete plugin install lock is retained as `d/.eduwork-plugin-install-lock.json`, with its hash in the assembly receipt.

The sequence is: test source → publish npm → verify registry bytes → update component and npm locks → qualify the assembled product. Compatibility ranges remain separate from exact product locks; production assembly never selects `latest`. Local development still uses each package's development root. Editions reuse the public npm dependencies and may add extensions, configuration and skills, but cannot overwrite locked public packages.

The historical DSH 0.1.5 recipe keeps `config/assembly.eduwork.json` and its exact version/SRI/SHA-256 locks under `third_party/npm-015-rc1/`; it is not the current default desktop recipe. Editing package source cannot silently change a desktop build. Follow [the build guide](BUILD.md): publish, verify the registry, update locks, then build the product. A development workspace link is not release evidence.

Component locks record each npm version, source commit and content hashes. Verify the actual registry archive before updating a lock. Development workspace links are not distribution inputs.
