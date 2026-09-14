// Public product entry. The local process lifecycle is shared with the existing
// integration launcher so there is one implementation of start/stop/logging.
await import('./dev-studio-web.mjs')
