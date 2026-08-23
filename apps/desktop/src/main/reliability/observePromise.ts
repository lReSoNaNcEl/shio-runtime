import { mainLog } from '../logging/safeLogger'

export function observeMainPromise<T>(
  promise: Promise<T>,
  context: string,
  onRejected?: (error: unknown) => void,
): void {
  promise.catch((error: unknown) => {
    mainLog.error(`[Promise] ${context} failed`, { error })
    try {
      onRejected?.(error)
    } catch (observerError) {
      mainLog.error(`[Promise] ${context} rejection observer failed`, { error: observerError })
    }
  })
}
