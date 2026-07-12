import { useSyncExternalStore } from 'react'
import { controller, type ControllerState } from '../Controller'

export function useControllerState(): ControllerState {
  return useSyncExternalStore(
    (cb) => controller.subscribe(() => cb()),
    () => controller.getState()
  )
}
