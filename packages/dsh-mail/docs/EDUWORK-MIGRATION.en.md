# eduwork npm scope migration

[简体中文](EDUWORK-MIGRATION.md) | **English**

Starting with `0.1.0`, the npm package is `@eduwork/dsh-mail`, replacing `dsh-mail-assistant`. The current installation example pins `0.1.1`. Source is maintained under `EduWork/packages/dsh-mail`.

## Installation and migration

```sh
dsh plugin --profile web add @eduwork/dsh-mail@0.1.1
```

Back up an existing Profile's package.json and cordis.patch.yml, then update its dependency and dsh.profile.bundles entries. Update module name paths in custom patches too. Do not enable both package identities together; restart the Host after switching. These are separate npm packages, so updating the old package cannot migrate an installation automatically.

## Data compatibility

Keep the Host export name, row id, settings namespace and security scope using `dsh-mail-assistant`, as well as `DSH_MAIL_ASSISTANT_PASSWORD` and `.dsh-mail-assistant/attachments`. The Client ModuleLoader uses the new package name.

Storage directories and user configuration content do not change. Product-managed Profiles migrate their owned dependencies through the product upgrader; community plugins remain unchanged.
