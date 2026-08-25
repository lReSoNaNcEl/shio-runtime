import { useCallback, useEffect, useRef, useState } from 'react'

import type { RuntimeSupportBundle } from '../../shared/system'

const RUNTIME_SUPPORT_REFRESH_MS = 30_000

export function useRuntimeSupportBundle(enabled: boolean) {
  const [bundle, setBundle] = useState<RuntimeSupportBundle | null>(null)
  const mounted = useRef(true)
  const inFlight = useRef<Promise<RuntimeSupportBundle> | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async (): Promise<RuntimeSupportBundle> => {
    inFlight.current ??= window.api.system.getRuntimeSupportBundle()
    try {
      const next = await inFlight.current
      if (mounted.current) setBundle(next)
      return next
    } finally {
      inFlight.current = null
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void refresh().catch(() => undefined)
    const intervalId = window.setInterval(() => {
      void refresh().catch(() => undefined)
    }, RUNTIME_SUPPORT_REFRESH_MS)
    return () => window.clearInterval(intervalId)
  }, [enabled, refresh])

  return { bundle, refresh }
}
