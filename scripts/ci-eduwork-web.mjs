// Local Web CI: source audit, shared assembly, bundled-configuration coverage
// and clean-profile functional validation with redactable public evidence.
// Node.js port of ci-eduwork-web.ps1.
import { createWriteStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  capture, copyFileTo, ensureDir, fullPath, isFile, isMainModule, pathExists,
  readJSON, run, statEntry, writeJSON, writeText,
} from './lib/build-util.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

async function runTeed(command, args, logPath, env) {
  const logStream = createWriteStream(logPath)
  try {
    await run(command, args, { echo: true, logStream, env })
  } finally {
    await new Promise(done => logStream.end(done))
  }
}

export async function ciEduworkWeb({
  coreRoot = join(scriptRoot, '..'),
  editionRoot = '',
  distributionConfig = 'config/distributions/generic.json',
  version = '',
  output = '',
  runtimeSource = '',
  upstream = '',
  verifySnapshot = false,
  buildOnly = false,
} = {}) {
  coreRoot = fullPath(coreRoot)
  editionRoot = fullPath(editionRoot || coreRoot)
  const institution = coreRoot !== editionRoot
  output = fullPath(output || join(coreRoot, 'dist/ci-local-web'))
  const evidence = join(output, 'evidence')
  const assemblyOutput = join(output, 'assembly')
  if (await pathExists(output)) throw new Error(`Use an empty CI output directory: ${output}`)
  const auditReports = new Map()
  const result = {
    schemaVersion: 1,
    kind: 'eduwork-local-web-ci',
    startedAt: new Date().toISOString(),
    edition: institution ? 'ecnu' : 'generic',
    sourceAudit: 'pending',
    build: 'pending',
    functionalValidation: 'pending',
    desktopRelease: 'deferred',
    passed: false,
  }
  try {
    const sourceReceipt = await readJSON(join(coreRoot, 'source-receipt.json'))
    if (!version) version = String(sourceReceipt.version)
    result.version = version
    const auditScript = join(coreRoot, 'scripts/audit-eduwork-distribution.mjs')
    const auditArgs = [auditScript, '--root', coreRoot, '--edition', 'generic']
    if (verifySnapshot || institution) auditArgs.push('--verify-receipt')
    auditReports.set('core-source-audit.json', await capture(process.execPath, auditArgs)
      .catch(() => { throw new Error('Public-core source audit failed.') }))
    if (institution) {
      const coreLock = await readJSON(join(editionRoot, 'core.lock.json'))
      if (coreLock.repository !== 'https://github.com/ecnu/EduWork.git' || !/^[a-f0-9]{40}$/.test(String(coreLock.commit))) {
        throw new Error('The institution must pin an exact public core commit.')
      }
      const actualCommit = await capture('git', ['-C', coreRoot, 'rev-parse', 'HEAD'])
      if (actualCommit !== coreLock.commit || sourceReceipt.fileSetSHA256 !== coreLock.sourceFileSetSHA256) {
        throw new Error('The checked-out core differs from the institution core.lock.json.')
      }
      const editionAuditArgs = [auditScript, '--root', editionRoot, '--edition', 'ecnu']
      if (verifySnapshot) editionAuditArgs.push('--verify-receipt')
      auditReports.set('institution-source-audit.json', await capture(process.execPath, editionAuditArgs)
        .catch(() => { throw new Error('Institution source audit failed.') }))
      result.coreCommit = actualCommit
    }
    result.sourceAudit = 'passed'
    await ensureDir(evidence)
    const assemble = join(coreRoot, 'scripts/assemble-eduwork-web.mjs')
    const test = join(coreRoot, 'scripts/test-eduwork-web.mjs')
    for (const entry of [assemble, test, join(coreRoot, 'scripts/prepare-eduwork-web-runtime.mjs')]) {
      if (!await isFile(entry)) throw new Error(`The shared Web build/validation entry is missing: ${entry}`)
    }
    const environment = { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' }
    const buildArguments = [
      assemble,
      '--core-root', coreRoot,
      '--edition-root', editionRoot,
      '--distribution-config', distributionConfig,
      '--output', assemblyOutput,
      '--version', version,
    ]
    if (runtimeSource) buildArguments.push('--runtime-source', fullPath(runtimeSource))
    if (upstream) buildArguments.push('--upstream', fullPath(upstream))
    result.explicitRuntimeCache = Boolean(runtimeSource)
    await runTeed(process.execPath, buildArguments, join(evidence, 'build.log'), environment)
    if (!await isFile(join(assemblyOutput, 'assembly.json'))) throw new Error('The assembled component receipt is missing.')
    const componentReceipt = await readJSON(join(assemblyOutput, 'assembly.json'))
    const managedSources = Object.values(componentReceipt.managedPackages ?? {})
    if (componentReceipt.runtimeMode !== 'npm' || componentReceipt.pluginMode !== 'npm' || managedSources.some(entry => entry.source !== 'npm')) {
      throw new Error('Default CI must validate the npm Runtime and registry-installed independent plugins')
    }
    result.dependencySource = 'npm-exact-locks'
    await run(process.execPath, [join(coreRoot, 'scripts/check-bundled-configuration.mjs'), assemblyOutput], { env: environment })
      .catch(() => { throw new Error('Installed bundle configuration coverage failed.') })
    await copyFileTo(join(assemblyOutput, 'assembly.json'), join(evidence, 'assembly.json'))
    result.build = 'passed'
    if (buildOnly) {
      result.functionalValidation = 'not-run-build-only'
    } else {
      await runTeed(process.execPath, [test, '--assembly', assemblyOutput, '--evidence', evidence, '--mode', 'clean-ci'], join(evidence, 'functional-validation.log'), environment)
        .catch(() => { throw new Error('Local Web functional validation failed.') })
      const validationReports = []
      for (const entry of await readdir(evidence, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('run-')) continue
        const path = join(evidence, entry.name, 'result.json')
        if (await isFile(path)) validationReports.push(await readJSON(path))
      }
      if (validationReports.length !== 1 || validationReports[0].passed !== true || validationReports[0].mode !== 'clean-ci') {
        throw new Error('Local Web validation must produce one successful clean-ci result; a zero exit code alone is insufficient.')
      }
      result.functionalValidation = 'passed'
    }
    result.passed = true
  } catch (error) {
    result.error = error.message
    throw error
  } finally {
    await ensureDir(evidence)
    for (const [name, report] of auditReports) {
      await writeText(join(evidence, name), report)
    }
    result.finishedAt = new Date().toISOString()
    await writeJSON(join(evidence, 'ci-result.json'), result)
    // The smoke runner owns a private home/config/authenticated local URL below
    // evidence. Share only reports designed to be redacted, never that runtime.
    const publicEvidence = join(evidence, 'public')
    await ensureDir(publicEvidence)
    for (const name of ['ci-result.json', 'core-source-audit.json', 'institution-source-audit.json', 'assembly.json']) {
      const source = join(evidence, name)
      if (await isFile(source)) await copyFileTo(source, join(publicEvidence, name))
    }
    for (const entry of await readdir(evidence, { withFileTypes: true })) {
      if (!entry.name.startsWith('run-')) continue
      if (entry.isSymbolicLink() || (await statEntry(join(evidence, entry.name)))?.isSymbolicLink()) {
        throw new Error('Validation evidence must not follow a directory link')
      }
      if (!entry.isDirectory()) continue
      const report = join(evidence, entry.name, 'result.json')
      if (await isFile(report)) await copyFileTo(report, join(publicEvidence, `${entry.name}-result.json`))
    }
  }
  return result
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'core-root': { type: 'string' },
      'edition-root': { type: 'string' },
      'distribution-config': { type: 'string' },
      version: { type: 'string' },
      output: { type: 'string' },
      'runtime-source': { type: 'string' },
      upstream: { type: 'string' },
      'verify-snapshot': { type: 'boolean' },
      'build-only': { type: 'boolean' },
    },
  })
  await ciEduworkWeb({
    ...(values['core-root'] ? { coreRoot: values['core-root'] } : {}),
    editionRoot: values['edition-root'] ?? '',
    distributionConfig: values['distribution-config'] ?? 'config/distributions/generic.json',
    version: values.version ?? '',
    output: values.output ?? '',
    runtimeSource: values['runtime-source'] ?? '',
    upstream: values.upstream ?? '',
    verifySnapshot: Boolean(values['verify-snapshot']),
    buildOnly: Boolean(values['build-only']),
  })
}
