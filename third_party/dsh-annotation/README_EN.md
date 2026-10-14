# Optional dsh-annotation UI patch

[简体中文](README.md)

This patch targets `client.js` from `@changfenhuang/dsh-annotation@1.4.11`, maintained at [omdsh-dev/dsh-annotation](https://github.com/omdsh-dev/dsh-annotation). See [LICENSE](LICENSE). It is provided for local qualification and upstream contribution. Installing the npm package does not automatically apply it.

`1.4.11-ui.patch` positions the toolbar using its actual dimensions at the selection focus and collapses annotations synchronously in changed user-message rows while retaining throttling for full-history scans and assistant labels. Cleanup is registered with the Cordis effect lifecycle. Repeated mounting releases the previous instance; delayed cleanup from an older context leaves the new instance intact.

## Apply

In a separate checkout of the 1.4.11 plugin, check and apply the patch using its absolute path:

```sh
git apply --check /path/to/1.4.11-ui.patch
git apply /path/to/1.4.11-ui.patch
node --check client.js
```

Use the official plugin manager to load the directory as a local development plugin in an isolated Profile, then reload the client. Keep the original package for rollback and reassess the patch when upgrading.

## Regression tests

The test requires a Node environment with `playwright-core` and a Chromium browser. Set `ANNOTATION_TEST_BROWSER` to use a local browser executable. Arguments identify the original package, patched package, and the `package.json` used to resolve Playwright:

```sh
node test-ui.mjs /path/to/original /path/to/patched /path/to/test-runtime/package.json
```

The fixture loads the complete plugin with synthetic DSH services, measures toolbar distance from the selection focus, and checks the first frame after successive row insertion and delayed text population. Desktop selection, submission, scaling, and history still require product acceptance.
