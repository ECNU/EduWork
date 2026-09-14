import assert from 'node:assert/strict'

// Also catches JSON-escaped Windows paths in generated bundles and tarballs.
export function assertPublicText(text, label) {
  assert.ok(!/[A-Z]:[\\/]+(?:Users[\\/]+|ECNUDev|ecnudev)|Administrator[\\/]+|\/Users\/[^/\s]+\//i.test(text), 'Machine path: ' + label)
  assert.ok(!/(?:ghp_|github_pat_|npm_)[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(text), 'Credential-shaped value: ' + label)
}
