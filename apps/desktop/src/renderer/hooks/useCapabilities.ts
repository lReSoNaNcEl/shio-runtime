import { useCallback, useEffect, useRef, useState } from 'react'

import type { ShioCapabilitySnapshot } from '../../shared/capabilities'
import { observeRendererPromise } from '../reliability/observePromise'

export interface CapabilitiesState {
  snapshot: ShioCapabilitySnapshot | null
  error: string | null
  refresh(): Promise<void>
}

export function useCapabilities(enabled: boolean): CapabilitiesState {
  const [snapshot, setSnapshot] = useState<ShioCapabilitySnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const latestGeneratedAt = useRef(-1)

  const commitSnapshot = useCallback((nextSnapshot: ShioCapabilitySnapshot): void => {
    if (nextSnapshot.generatedAt < latestGeneratedAt.current) return
    latestGeneratedAt.current = nextSnapshot.generatedAt
    setSnapshot(nextSnapshot)
    setError(null)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) return
    const sequence = ++requestSequence.current
    try {
      const nextSnapshot = await window.api.capabilities.snapshot()
      if (sequence !== requestSequence.current) return
      commitSnapshot(nextSnapshot)
    } catch (cause) {
      if (sequence !== requestSequence.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [commitSnapshot, enabled])

  useEffect(() => {
    if (!enabled) return
    let active = true
    const unsubscribe = window.api.capabilities.onChanged((nextSnapshot) => {
      if (!active) return
      requestSequence.current += 1
      commitSnapshot(nextSnapshot)
    })
    observeRendererPromise(refresh(), 'load capability catalog')
    return () => {
      active = false
      requestSequence.current += 1
      unsubscribe()
    }
  }, [commitSnapshot, enabled, refresh])

  return { snapshot, error, refresh }
}
