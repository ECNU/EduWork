import { execFile as nodeExecFile } from 'node:child_process'
import { isAbsolute, join, posix, win32 } from 'node:path'
import {fileURLToPath} from 'node:url'
import {structuredSpec} from './structured-spec.js'

export const PYTHON_ENV = 'DSH_OFFICE_PYTHON'
const runner = fileURLToPath(new URL('../python/runner.py', import.meta.url))
export const MAX_SPEC_CHARACTERS = 1024 * 1024

const MIME = Object.freeze({
  document: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  spreadsheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
})

const CONTRACTS = Object.freeze({
  document: Object.freeze({
    extension: '.docx', module: 'documents',
    actions: Object.freeze({
      create: { command: 'create_document', write: true, output: true, spec: true },
      edit: { command: 'edit_document', write: true, input: true, output: true, spec: true },
      inspect: { command: 'inspect_document', input: true },
      validate: { command: 'validate_document', input: true },
    }),
  }),
  spreadsheet: Object.freeze({
    extension: '.xlsx', module: 'spreadsheets',
    actions: Object.freeze({
      create: { command: 'create_workbook', write: true, output: true, spec: true },
      edit: { command: 'edit_workbook', write: true, input: true, output: true, spec: true },
      inspect: { command: 'inspect_workbook', input: true },
      validate: { command: 'validate_workbook', input: true },
    }),
  }),
  presentation: Object.freeze({
    extension: '.pptx', module: 'presentations',
    actions: Object.freeze({
      create: { command: 'create_presentation', write: true, output: true, spec: true },
      inspect: { command: 'inspect_presentation', input: true },
      validate: { command: 'validate_presentation', input: true, strict: true },
    }),
  }),
  pdf: Object.freeze({
    extension: '.pdf', module: 'pdfs',
    actions: Object.freeze({
      create: { command: 'create_pdf', write: true, output: true, spec: true },
      inspect: { command: 'inspect_pdf', input: true },
      merge: { command: 'merge_pdf', write: true, inputs: true, output: true },
      extract: { command: 'extract_pages', write: true, input: true, output: true, pages: true },
      validate: { command: 'validate_pdf', input: true },
    }),
  }),
})

function text(value, field, maximum = 4096) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error(`${field} must not be empty`)
  if (Array.from(normalized).length > maximum) throw new Error(`${field} is too long`)
  return normalized
}

export function normalizeRelativePath(value, field, extension) {
  const raw = text(value, field)
  if (raw.includes('\0') || isAbsolute(raw) || win32.isAbsolute(raw) || posix.isAbsolute(raw)) {
    throw new Error(`${field} must be a project-relative path`)
  }
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '')
  if (normalized.split('/').some(part => part === '..' || part === '')) throw new Error(`${field} must stay inside the current project`)
  if (!normalized.toLowerCase().endsWith(extension)) throw new Error(`${field} must end with ${extension}`)
  return normalized
}

function normalizeInputs(value, extension) {
  const raw = text(value, 'input_paths_json', 64 * 1024)
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('input_paths_json must contain a JSON array')
  }
  if (!Array.isArray(parsed) || parsed.length < 2 || parsed.length > 50) throw new Error('input_paths_json must contain 2 to 50 paths')
  return parsed.map((path, index) => normalizeRelativePath(path, `input_paths_json[${index}]`, extension))
}

export function contractFor(format, action) {
  const contract = CONTRACTS[format]
  if (contract === undefined) throw new Error(`unsupported office format: ${format}`)
  const operation = contract.actions[action]
  if (operation === undefined) throw new Error(`unsupported ${format} action: ${action}`)
  return { contract, operation }
}

export function normalizeOfficeRequest(format, args) {
  const action = text(args.action, 'action', 32).toLowerCase()
  const { contract, operation } = contractFor(format, action)
  const normalized = { format, action, write: operation.write === true }
  if (operation.input) normalized.inputPath = normalizeRelativePath(args.input_path, 'input_path', contract.extension)
  if (operation.output) normalized.outputPath = normalizeRelativePath(args.output_path, 'output_path', contract.extension)
  if (operation.inputs) normalized.inputPaths = normalizeInputs(args.input_paths_json, contract.extension)
  if (operation.spec) normalized.specJSON = JSON.stringify(structuredSpec(args,MAX_SPEC_CHARACTERS))
  if (operation.pages) normalized.pages = text(args.pages, 'pages', 2048)
  if (operation.strict && args.strict === true) normalized.strict = true
  return Object.freeze(normalized)
}

export function buildOfficeInvocation(request, projectPath) {
  const { contract, operation } = contractFor(request.format, request.action)
  const absolute = relativePath => join(projectPath, ...relativePath.split('/'))
  const args = ['-I', '-X', 'utf8', runner, `${contract.module}.${operation.command}`, '--project-root', projectPath]
  if (request.inputPath !== undefined) args.push('--input', absolute(request.inputPath))
  for (const input of request.inputPaths ?? []) args.push('--input', absolute(input))
  if (request.outputPath !== undefined) args.push('--output', absolute(request.outputPath))
  if (request.specJSON !== undefined) args.push('--spec-json', request.specJSON)
  if (request.pages !== undefined) args.push('--pages', request.pages)
  if (request.strict === true) args.push('--strict')
  return Object.freeze({ args, mime: MIME[request.format], artifact: request.outputPath })
}

export function privatePython(environment = process.env) {
  const candidate = typeof (environment?.[PYTHON_ENV] ?? environment?.CHATECNU_WORK_OFFICE_PYTHON) === 'string' ? (environment[PYTHON_ENV] ?? environment.CHATECNU_WORK_OFFICE_PYTHON).trim() : ''
  if (candidate.length === 0 || (!isAbsolute(candidate) && !win32.isAbsolute(candidate))) {
    throw new Error('Office runtime is unavailable; configure DSH_OFFICE_PYTHON with a Python interpreter containing python/requirements.txt')
  }
  return candidate
}

function execFilePromise(command, args, options, execFileImpl = nodeExecFile) {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, options, (error, stdout, stderr) => {
      if (error !== null) {
        const detail = String(stderr ?? '').trim() || String(stdout ?? '').trim()
        reject(new Error(detail.length > 0 ? `office operation failed: ${detail.slice(0, 4000)}` : `office operation failed with exit code ${error.code ?? 'unknown'}`))
        return
      }
      resolve(String(stdout ?? ''))
    })
  })
}

export async function runOffice({ request, projectPath, signal, environment = process.env, execFileImpl }) {
  const invocation = buildOfficeInvocation(request, projectPath)
  const stdout = await execFilePromise(privatePython(environment), invocation.args, {
    cwd: projectPath, env: environment, windowsHide: true, timeout: 180_000,
    signal, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
  }, execFileImpl)
  let report
  try {
    report = JSON.parse(stdout.trim())
  } catch {
    throw new Error('office runtime returned invalid JSON')
  }
  return { invocation, report }
}

export function actionNeedsApproval(format, args) {
  try {
    return normalizeOfficeRequest(format, args).write
  } catch {
    return true
  }
}

/**
 * DSH persists presentation metadata through a lossless-JSON codec.  An
 * explicit `undefined` is therefore not a valid metadata value; read-only
 * operations use an empty object instead.
 */
export function officePresentationMeta(value) {
  if (value === null || typeof value !== 'object' || typeof value.relativePath !== 'string') return {}
  return {
    relativePath: value.relativePath,
    ...(typeof value.mime === 'string' ? { mime: value.mime } : {}),
  }
}

/**
 * Project write operations expose their output path to the conversation UI.
 * The media-artifacts plugin consumes this standard DSH call location only
 * after a successful result, so failed attempts never become fake files.
 */
export function presentOfficeCall(format, toolName, args) {
  let request
  try {
    request = normalizeOfficeRequest(format, args)
  } catch {
    request = null
  }
  const write = request?.write ?? true
  const path = write ? request?.outputPath : request?.inputPath
  return {
    card: 'generic',
    title: `${toolName} · ${args.action ?? 'operation'}`,
    kind: write ? 'edit' : 'read',
    ...(typeof path === 'string' ? { locations: [{ path }] } : {}),
  }
}

export {renderOfficePreview} from './office-preview.js'
