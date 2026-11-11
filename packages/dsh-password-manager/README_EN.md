# Built-in password manager

[中文](README.md)

An unpublished optional EduWork browser-vault and Agent-login candidate. Successful manual sign-in offers to save or update passwords. Select an account to fill on later visits. Credentials are encrypted locally by the operating system.

Settings → Password manager provides account management and the default-off Agent permission switch. Search Settings for “password” to find it. Choose an account on first Agent use; grants last for the conversation. Turning off the switch cancels active Agent login and revokes grants.

Call `password_manager` with `action: "login"` and the HTTPS login `url`. Native code fills and submits in an isolated session, destroys the credential page, then transfers cookies to the sidebar. Tools return fixed status values only. `session-ready` means cookie handoff; verify the signed-in page separately.

Automatic login initially supports same-origin HTTPS POST forms, full navigation and cookie sessions. MFA, SPA, multi-step and cross-origin SSO need further support. Ordinary browser scripts and debugging can read manually filled fields; isolation protects the Agent credential execution path.

Enable the desktop candidate with `EDUWORK_BUILTIN_PASSWORDS=1`. Windows is the validation target; macOS automatic login is disabled. See the [development guide](DEVELOPMENT.md).

The browser password manager master switch stops save prompts, filling and Agent use while retaining saved accounts and website sessions. Search saved accounts by website or username.
