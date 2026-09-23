// Redact whole lines: a credential can span arbitrary stdout/stderr chunks.
// Overlong lines are discarded entirely rather than exposing an unredacted tail.
export const redactHostDiagnostic = text => text.replace(/([?&]token=)[^\s&]+/gu, '$1[redacted]')
export function bindRedactedLog(stream, emit, limit = 16384) {
  if (!stream) return
  let pending = '', dropped = false
  const flush = () => {
    emit?.(dropped ? '[oversized Host log omitted]\n' : redactHostDiagnostic(pending) + '\n')
    pending = ''; dropped = false
  }
  stream.setEncoding('utf8')
  stream.on('data', chunk => {
    const parts = chunk.split('\n')
    for (let index = 0; index < parts.length; index++) {
      if (!dropped) {
        if (pending.length + parts[index].length > limit) { pending = ''; dropped = true }
        else pending += parts[index]
      }
      if (index < parts.length - 1) flush()
    }
  })
  stream.once('end', () => { if (pending || dropped) flush() })
}
