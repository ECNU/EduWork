# ADR 0002: Exact service reads and account identity for trusted Hosts

[简体中文](0002-host-service-reads.md) | **English**

- Status: proposed, awaiting maintainer acceptance; neither a release nor a frozen contract.
- Requirement: authorized subscriptions and account isolation in [EduWork #186](https://github.com/ECNU/EduWork/issues/186).

Business plugins must reuse OIDC credentials without storing tokens or adding institution endpoints to the public identity package. Model-resource prefixes and issuer POST paths do not cover an explicitly approved read-only timetable endpoint.

The Host-only `authorizedFetch(profileID, endpoint, init, { serviceURL })` grants one exact normalized destination: HTTPS, GET with no body, no URL credentials, fragments or redirects. It does not widen persisted model-resource permissions or add a Remote/OpenAPI endpoint. Only trusted Host code may derive this option from institution configuration; renderer, model and feed data must never supply the authorization target directly. The subscription Host checks an exact `authorizedServices: [{ profileID, url }]` allowlist first. Arbitrary Host plugins already belong to the trusted-code boundary.

For test services, both the subscription Host and OIDC Profile must explicitly enable `allowInsecureDevelopment`. The only additional destinations are exact HTTP URLs with literal loopback IPs `127.0.0.1` or `[::1]`. Hostnames including localhost and non-loopback IPs remain denied. The default production policy stays HTTPS-only; this never adds a wildcard origin.

Host-only `accountIdentity(profileID)` returns `{ profileID, accountID }`, or null when signed out. accountID hashes the profile, issuer and verified subject using SHA256. It returns no raw subject, token or other credential, remains stable across refresh and changes for a different account. It scopes local caches and is not proof of login to a server.

Existing credential storage, renewal, timeouts, one-time 401 recovery and account epochs remain in force. Consumers check identity before and after requests, observe `oidc/accounts-changed`, cancel on logout/replacement and reject late results. Failed reads preserve the successful snapshot; signed-out caches are hidden. Subscriptions bound bodies to 5 MiB and do not expose credential-bearing errors or bodies.

Permanently authorizing every institution origin would permit unrelated same-origin paths and couple business configuration to identity. Letting models choose grants or letting plugins store tokens is also rejected. Exact single-request reads keep the capability narrow.

Checks cover destination/method/protocol rejection, stable account IDs, renewal, persistent 401s, logout and late account-switch results. Real loopback resource/token servers join the backend and subscription stack. This does not establish real school login, HTTPS deployment or Electron acceptance. Independent technical review and maintainer acceptance remain necessary before freezing or publication.
