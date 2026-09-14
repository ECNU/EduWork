# ADR 0001: One plugin for the enterprise integration loop

[简体中文](0001-one-plugin-composition-boundary.md) | **English**

- Status: Accepted
- Date: 2026-08-25

## Context

The original product implementation coupled OIDC account behavior, institution catalog, a private Provider package, desktop bridges, and product features. Publishing only the login portion would leave users unable to call a model; publishing every desktop concern would bind the standard to Wails and one institution.

## Decision

Publish one project/package named `dsh-oidc` containing:

- standard OIDC Web client and a host-neutral native adapter contract;
- the fixed Key Binding client;
- one local audited OpenAI-compatible DSH Provider adapter;
- declarative Provider/model and bounded brand configuration;
- standard account UI and one capability-aware enterprise-model settings surface shared by Web/native hosts;
- `models-only` and external UI composition modes;
- a stable local model-transform service.

Keep desktop shells, quotas, institutional business APIs, search, vision implementations, skills, packaging, and updates outside this repository.

Enterprise Profiles are data and cannot select executable adapters or customize Key Binding wire fields.

## Consequences

- A plain Web DSH can complete enterprise login-to-model flow with one plugin plus a profile.
- Desktop products preserve richer native operations behind host services while inheriting the same provider/model UI.
- The former private Provider package is internalized, eliminating an unpublished dependency.
- The plugin carries more responsibility than a generic OIDC login widget, so its security and compatibility review must cover credentials and model transport integration.
- Additional Provider protocol families require reviewed local code and an architectural decision; they cannot be enabled by remote profile data.
