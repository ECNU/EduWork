import { useCallback, useEffect, useSyncExternalStore } from 'react'

export function useAccountStatus(service: any, profileID: string) {
  const subscribe = useCallback((changed: () => void) => service.subscribeAccounts((id: string) => { if (id === profileID) changed() }), [service, profileID])
  const snapshot = useCallback(() => service.accountSnapshot(profileID), [service, profileID])
  const status = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => { service.status(profileID).catch(() => {}) }, [service, profileID])
  return status
}
