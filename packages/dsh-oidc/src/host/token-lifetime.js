const ACCESS_REFRESH_SECONDS = 30 * 60

// Refresh early without repeatedly renewing tokens whose entire lifetime is
// shorter than the normal margin. These timestamps stay in the Host vault.
export function accessTokenTiming(expiresIn, now) {
  const expiresAt = Math.floor(now() / 1000) + expiresIn
  return { expiresAt, refreshAt: expiresAt - Math.min(ACCESS_REFRESH_SECONDS, expiresIn / 2) }
}

export function accessTokenNeedsRefresh(session, now) {
  // Existing installations have only expiresAt. Their first refresh adds the
  // lifetime-aware timestamp; no migration or new sign-in is required.
  const refreshAt = Number.isFinite(session.refreshAt) ? session.refreshAt : session.expiresAt - ACCESS_REFRESH_SECONDS
  return now() / 1000 >= Math.min(session.expiresAt, refreshAt)
}
