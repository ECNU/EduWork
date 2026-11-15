export function createSettingsOpenRequest({ send, ready = () => true }) {
  let pending = false
  let sending = false
  const flush = async () => {
    if (!pending || sending || !ready()) return false
    sending = true
    try {
      if (await send()) {
        pending = false
        return true
      }
    } catch {
      // The renderer cannot receive the action yet; the next load/ready signal retries.
    } finally {
      sending = false
    }
    return false
  }
  return {
    request() { pending = true; return flush() },
    flush,
    pending: () => pending,
  }
}
