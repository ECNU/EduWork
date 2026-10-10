// Builds the unsigned macOS institution configuration package (.pkg) that
// installs the external eduwork.jsonc. Node.js port of
// package-macos-external-config.ps1. Requires macOS.
import { chmod, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  capture, copyFileTo, ensureDir, fullPath, isMacOS, isMainModule, pathExists,
  removeTree, run, sha256File, statEntry, writeJSON, writeText,
} from './lib/build-util.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

export async function packageMacosExternalConfig({
  config,
  output,
  version,
  installRoot = '/Library/Application Support/EduWork-ECNU/config',
  packageIdentifier = 'org.eduwork.ecnu.config',
} = {}) {
  if (!isMacOS) throw new Error('The macOS configuration package must be built on macOS')
  if (!/^\d+\.\d+\.\d+(?:-dev\.\d{8}\.[1-9]\d*)?$/.test(version ?? '')) throw new Error('An exact product version is required')
  if (installRoot !== '/Library/Application Support/EduWork-ECNU/config') throw new Error('Unexpected external configuration install root')
  if (!/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$/.test(packageIdentifier)) throw new Error('Invalid package identifier')

  config = fullPath(config)
  output = fullPath(output)
  if (await pathExists(output)) throw new Error('Configuration package output must be a new file')
  if (extname(output) !== '.pkg') throw new Error('Configuration package output must use the .pkg extension')

  const validation = await capture(process.execPath, [join(scriptRoot, 'validate-distribution-config.mjs'), config])
    .catch(() => { throw new Error('Institution configuration validation failed') })
  const configSummary = JSON.parse(validation.trim().split('\n').at(-1))
  const configHash = await sha256File(config)
  const targetName = 'eduwork.jsonc'
  const targetPath = `${installRoot}/${targetName}`
  const development = version.match(/^(\d+\.\d+\.\d+)-dev\.(\d{8})\.([1-9]\d*)$/)
  const packageVersion = development ? `${development[1]}.${development[2]}.${development[3]}` : version

  await ensureDir(dirname(output))
  const staging = await mkdtemp(join(tmpdir(), 'eduwork-config-pkg-'))
  try {
    const payload = join(staging, 'payload')
    const payloadConfig = join(payload, installRoot.replace(/^\//, ''))
    await ensureDir(payloadConfig)
    const stagedConfig = join(payloadConfig, targetName)
    await copyFileTo(config, stagedConfig)
    await chmod(stagedConfig, 0o644)
    await run('xattr', ['-cr', payload])
      .catch(() => { throw new Error('Configuration metadata cleanup failed') })
    await run('pkgbuild', [
      '--root', payload, '--identifier', packageIdentifier, '--version', packageVersion,
      '--install-location', '/', '--ownership', 'recommended', output,
    ]).catch(() => { throw new Error('Configuration package build failed') })
  } finally {
    await removeTree(staging)
  }

  const packageHash = await sha256File(output)
  await writeText(`${output}.sha256`, `${packageHash}  ${basename(output)}`)
  const receipt = {
    schemaVersion: 1,
    kind: 'eduwork-macos-external-configuration',
    productVersion: version,
    packageIdentifier,
    installPath: targetPath,
    organizations: configSummary.organizations,
    updateDefaultPolicy: configSummary.defaultPolicy,
    configSHA256: configHash,
    package: { name: basename(output), bytes: (await statEntry(output)).size, sha256: packageHash },
    signed: false,
    notarized: false,
    assembledAt: new Date().toISOString(),
  }
  await writeJSON(`${output}.receipt.json`, receipt)
  console.log(JSON.stringify(receipt, null, 2))
  return receipt
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      output: { type: 'string' },
      version: { type: 'string' },
      'install-root': { type: 'string' },
      'package-identifier': { type: 'string' },
    },
  })
  if (!values.config || !values.output || !values.version) {
    throw new Error('Use --config <eduwork.jsonc> --output <file.pkg> --version <x.y.z> [--install-root <dir>] [--package-identifier <id>]')
  }
  await packageMacosExternalConfig({
    config: values.config,
    output: values.output,
    version: values.version,
    installRoot: values['install-root'] ?? '/Library/Application Support/EduWork-ECNU/config',
    packageIdentifier: values['package-identifier'] ?? 'org.eduwork.ecnu.config',
  })
}
