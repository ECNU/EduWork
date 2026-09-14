import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const platformPackages = Object.freeze({
  'darwin-arm64': '@ladybugdb/core-darwin-arm64',
  'darwin-x64': '@ladybugdb/core-darwin-x64',
  'linux-arm64': '@ladybugdb/core-linux-arm64',
  'linux-x64': '@ladybugdb/core-linux-x64',
  'win32-x64': '@ladybugdb/core-win32-x64',
})

const platformKey = `${process.platform}-${process.arch}`
const packageName = platformPackages[platformKey]

if (!packageName) {
  throw new Error(
    `dsh-knowledge-studio does not support LadybugDB on ${platformKey}. ` +
    `Supported platforms: ${Object.keys(platformPackages).join(', ')}`,
  )
}

let binding
try {
  binding = require(packageName)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  throw new Error(
    `LadybugDB runtime ${packageName} is unavailable for ${platformKey}. ` +
    `Reinstall dsh-knowledge-studio with optional dependencies enabled. ${message}`,
    { cause: error },
  )
}

export const { Database, Connection } = binding
