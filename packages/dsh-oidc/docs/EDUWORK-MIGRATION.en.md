# Package and enterprise-credential migration

[简体中文](EDUWORK-MIGRATION.md) | **English**

Starting with `0.1.0-alpha.11`, the npm package identity changed to `@eduwork/dsh-oidc`, replacing `dsh-oidc`; `0.1.0` is the first stable semantic version after that migration. Source is maintained under `EduWork/packages/dsh-oidc`.

## Historical npm scope migration (0.1.0)

```sh
dsh plugin --profile web add @eduwork/dsh-oidc@0.1.0
```

Back up an existing Profile's package.json and cordis.patch.yml, then update its dependency and dsh.profile.bundles entries. Update module name paths in custom patches too. Do not enable both package identities together; restart the Host after switching. These are separate npm packages, so updating the old package cannot migrate an installation automatically.

## Data compatibility

Keep `dsh-oidc/v1alpha1`, `oidcAccounts`, credential references, Provider identities and plugin row ids. Host and Client TYPERT package identities change together.

Storage directories and user configuration content do not change. Product-managed Profiles migrate their owned dependencies through the product upgrader; community plugins remain unchanged.

## Enterprise credentials in 0.2.x

The default local reference is `EDUWORK_API_KEY`, independent of institution and Provider names. Explicit legacy automatic references derived from the same Profile ID or Provider ID (uppercase, non-alphanumerics replaced with `_`, plus `_API_KEY`) normalize to the new default. Unrelated custom references such as `MY_TEST_MODEL_KEY` remain unchanged. This is a local secret-store name, never a new server request field.

An existing Web/desktop session may migrate a legacy key only when issuer, client ID, management URL, runtime URL and Provider ID match and only the reference changes. The destination must be empty; another profile must not claim the source; a saved fingerprint, when present, must match. Migration never imports arbitrary environment keys, overwrites an occupied destination, or trusts a key from a different deployment. Config files are read compatibly rather than overwritten.

After a different organization binds the common slot, only the session owning its current fingerprint may call that Provider. Other sessions retain identity but need resource reconnection; their logout cannot delete the new owner's key. Manually configured personal model keys remain untouched. If endpoints change, identity may remain valid while model credentials must be rebound; changed issuer/client ID requires sign-in again. Do not manually copy keys to bypass these checks.

Both new desktop shells use the common desktop backend. Legacy `native` account bridges still own their credential storage and must return a matching reference; this plugin does not rewrite OS-vault entries. Plugin migration moves no workspaces, history directories or application data; shell-level data migration belongs to the product.
