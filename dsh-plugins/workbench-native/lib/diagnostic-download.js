export function downloadDiagnosticArchive(result) {
  if (!result.archive || !/^EduWork-diagnostics-[\w-]+\.zip$/.test(result.filename || '')) {
    throw new Error(result.message || '诊断包未生成，请重试。')
  }
  const bytes = Uint8Array.from(atob(result.archive), char => char.charCodeAt(0))
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) throw new Error('诊断包格式错误，请重试。')
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url; link.download = result.filename
  document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
