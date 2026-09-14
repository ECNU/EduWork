import { useEffect, useRef, useState } from 'react'
import { signIn } from './login-flow.js'

export function useSignIn(service: any) {
  const controller = useRef<AbortController | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => () => { controller.current?.abort() }, [])
  return {
    pending,
    cancel: () => controller.current?.abort(),
    begin: async (profileID: string) => {
      controller.current?.abort()
      const current = new AbortController()
      controller.current = current
      return signIn(service, profileID, { signal: current.signal, onPending: value => setPending(Boolean(value)) })
    },
  }
}
