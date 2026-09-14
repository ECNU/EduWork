const resultPathTools = new Set([
  'artifact_publish',
  'image_generate',
  'ecnu_image_generate',
  'ecnu_tts_generate',
  'speech_synthesize',
  'media_render',
  'video_project',
  'office_document',
  'office_spreadsheet',
  'office_presentation',
  'office_pdf',
])

const officeWriteActions = new Set(['create', 'edit', 'merge', 'extract'])

function parsedArguments(argsRaw) {
  try {
    const value = JSON.parse(argsRaw)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function pathValue(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validEditArgs(args) {
  return typeof args.old_string === 'string'
    && args.old_string.length > 0
    && typeof args.new_string === 'string'
    && args.old_string !== args.new_string
    && (args.replace_all === undefined || typeof args.replace_all === 'boolean')
}

function editorMutationPath(args) {
  const path = pathValue(args.path)
  if (path === null) return null
  switch (args.command) {
    case 'create':
      return typeof args.file_text === 'string' ? path : null
    case 'str_replace':
      return typeof args.old_str === 'string'
        && args.old_str.length > 0
        && (args.new_str === undefined || typeof args.new_str === 'string')
        ? path
        : null
    case 'insert':
      return typeof args.insert_line === 'number'
        && Number.isInteger(args.insert_line)
        && args.insert_line >= 0
        && typeof args.new_str === 'string'
        ? path
        : null
    default:
      return null
  }
}

function argumentArtifactPath(name, args) {
  switch (name) {
    case 'write':
      return typeof args.content === 'string' ? pathValue(args.file_path) : null
    case 'edit':
      return validEditArgs(args) ? pathValue(args.file_path) : null
    case 'str_replace_editor':
      return editorMutationPath(args)
    case 'artifact_publish':
      return pathValue(args.relative_path)
    case 'office_document':
    case 'office_spreadsheet':
    case 'office_presentation':
    case 'office_pdf':
      return typeof args.action === 'string' && officeWriteActions.has(args.action.toLowerCase())
        ? pathValue(args.output_path)
        : null
    default:
      return null
  }
}

export function uniquePaths(paths) {
  return [...new Set(paths.filter(path => typeof path === 'string' && path.trim().length > 0))]
}

export function trackedArtifactCall(name, argsRaw) {
  const args = parsedArguments(argsRaw)
  const path = args === null ? null : argumentArtifactPath(name, args)
  return { name, paths: path === null ? [] : [path] }
}

export function successfulArtifactPaths(call, meta) {
  if (call === undefined) return []
  const resultPath = resultPathTools.has(call.name) && isRecord(meta)
    ? pathValue(meta.relativePath)
    : null
  return uniquePaths([...call.paths, resultPath])
}
