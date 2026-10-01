// Publishers may supply concise, localized card text independently of the
// model-facing description. Missing fields retain the public product defaults.
export function skillDisplayMetadata(data) {
  const metadata = data?.metadata?.eduwork
  const text = (value, maximum) => typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maximum) : undefined
  const displayName = text(metadata?.displayName, 128)
  const displayDescription = text(metadata?.displayDescription, 1024)
  return {
    ...(displayName ? { displayName } : {}),
    ...(displayDescription ? { displayDescription } : {}),
  }
}
