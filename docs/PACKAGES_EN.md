# Package development and publication

[简体中文](PACKAGES.md) | **English**

EduWork maintains its public plugins in one source repository. Each npm package retains its identity, version and independent installation/publication. Issues, PRs, protocols and development documentation belong to `ecnu/EduWork`; institutional implementations remain in EduWork-ECNU. Other DSH applications can use individual plugins without the EduWork desktop client.

| npm package | Source and documentation | Installation root |
| --- | --- | --- |
| `@eduwork/dsh-oidc` | [Identity, credentials and models](../packages/dsh-oidc/README_EN.md) | `packages/dsh-oidc` |
| `@eduwork/dsh-memory` | [Local memory and retrieval](../packages/dsh-memory/README_EN.md) | `packages/dsh-memory` |
| `@eduwork/dsh-mail` | [Mail assistant](../packages/dsh-mail/README_EN.md) | `packages/dsh-mail` |
| `@eduwork/dsh-knowledge-studio` | [Studio](../packages/dsh-knowledge-studio/README_EN.md) | `packages/dsh-knowledge-studio` |
| `@eduwork/dsh-artifact-services` | [Office, speech, images and media](../packages/dsh-knowledge-studio/packages/artifact-services/README_EN.md) | Studio's existing workspace |

Four development roots retain their own dependency locks without repository-wide hoisting. Studio keeps its existing `packages/artifact-services` workspace; each package still produces its own tarball. Other packages communicate through public npm exports, not relative imports into another package's implementation.

## Develop and check

Use each manifest and lock for Node/DSH requirements; common CI uses Node 24.18.0. From the repository root:

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

Each package keeps its own SemVer, public exports, configuration IDs and persisted paths. Use a new version for every publication; never overwrite an existing npm version. If shared services change version, update Studio's exact dependency and lock; publish and verify shared services before Studio.

Use **Package npm module**, `.github/workflows/packages-release.yml`. Select one package. The default `publish=false` builds, tests and packages without publishing. Plugins publish only to npm, without plugin GitHub Releases or Git tags. GitHub release entries are reserved for desktop client versions.

1. Review the package version, changelog and relevant local acceptance, then commit source and locks.
2. Merge and push the reviewed changes to `main`, then record the full 40-character commit SHA intended for publication.
3. Select `main` as the **Run workflow** source, enter that SHA in `source_commit`, select the package and set `publish=true`. The workflow pins the triggering commit; a mismatch with the supplied SHA stops publication so the source can be reviewed again. Use `latest` for stable versions and `dev` for prereleases. Product versions do not control package versions.
4. CI publishes the checked archive from the same run, verifying its source, identity and hashes without rebuilding or lifecycle scripts. Verify the resulting npm version, integrity and provenance before updating product locks.

Configure Trusted publishing on **each npm package**: GitHub Actions, organization `ecnu`, repository `EduWork`, workflow `packages-release.yml`, environment `npm`. The GitHub environment has the same name. The provenance-based publication path requires a public repository and a valid binding. Use `publish=false` to check and package without publishing. See [npm's requirements](https://docs.npmjs.com/trusted-publishers/).

Maintainers can inspect a binding with `npm trust list @eduwork/dsh-oidc --json`, substituting the other package names as needed. To change the repository, workflow or environment, inspect existing bindings first, create the replacement and remove only the matching obsolete binding. Preserve other valid publishers. npm may require account verification in the system browser.

Do not store long-lived npm tokens. If publication is explicitly authorized before CI publication is verified, a maintainer can publish an inspected archive with an authenticated npm CLI and interactive verification, without claiming GitHub provenance.

## Product assembly

`config/assembly.eduwork.json` still consumes published registry archives through exact version/SRI/SHA-256 locks in `third_party/npm-015-rc1/`. Editing package source cannot silently change a desktop build. Follow [the build guide](BUILD.md): publish, verify the registry, update locks, then build the product. A development workspace link is not release evidence.

Component locks record each npm version, source commit and content hashes. Verify the actual registry archive before updating a lock. Development workspace links are not distribution inputs.
