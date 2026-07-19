import { useSyncExternalStore } from 'react'

import { type ControllerState, controller } from '../Controller'

export function useControllerState(): ControllerState {
  return useSyncExternalStore(
    (cb) => controller.subscribe(() => cb()),
    () => controller.getState(),
  )
}
