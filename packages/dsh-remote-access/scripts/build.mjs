// The package is plain ES modules on the host side, so the build is a copy
// rather than a bundle: `src/` is what runs in tests, `lib/` is what ships.
// Keeping them byte-identical is the point — there is no transform that could
// let the published artifact differ from the one under test.
import { cp, mkdir, rm } from 'node:fs/promises'

await rm('lib', { recursive: true, force: true })
await mkdir('lib', { recursive: true })
await cp('src', 'lib', { recursive: true })
