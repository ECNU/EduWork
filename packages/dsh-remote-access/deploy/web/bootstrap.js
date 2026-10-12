// Placeholder. Replace this file before running the relay.
//
// ## Why the real one is not here
//
// The browser bootstrap is the device half of the end-to-end channel: it holds the
// device's private key, terminates the handshake and seals every call. The relay
// serves it to the phone, which means the relay operator can replace it, and that
// is the one thing the end-to-end property does not protect against. It is stated
// plainly here so nobody reads more into this than it says.
//
// It is also the most deployment-specific file in the feature. Its WebSocket path,
// how a device is told which Host to reach, what it does before a device has ever
// paired, and the name the application looks for are decisions a deployment makes,
// not ones the plugin can make for everybody. A copy in this repository would be a
// default that silently becomes every deployment's configuration.
//
// So the relay ships the slot and the deployment fills it.
//
// ## What must be true of whatever replaces this
//
//   * It is a CLASSIC script, not a module. The relay injects
//     <script src=".../bootstrap.js"></script> ahead of the application's
//     <script type="module">, and a module script is deferred, so it would run
//     after the application has already looked for the transport.
//   * It is served from this path. deploy/server.mjs passes
//     "/eduwork-assets/bootstrap.js" to the relay, and the relay serves that path
//     out of its webRoot directory, which is where this file is.
//   * It must install the transport the application reads BEFORE any module runs.
//
// ## Where a working one lives
//
// With the rest of the deployment, outside this package.
// scripts/build-deploy.ps1 takes -BootstrapPath and copies it here; nothing else
// is needed for the relay to pick it up.
//
// A bootstrap that connects without doing the handshake and sealing would still
// appear to work while providing no confidentiality at all, so the relay cannot
// check this for you. Getting it wrong is silent. Test it against a real Host.

console.error(
  "[eduwork-relay] this is the placeholder bootstrap from @eduwork/dsh-remote-access.\n" +
  "[eduwork-relay] the page will load, but remote access is not connected and nothing is sealed.\n" +
  "[eduwork-relay] replace web/bootstrap.js with your deployment's build before using this relay."
)
