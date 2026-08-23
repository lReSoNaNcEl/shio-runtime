export function observeRendererPromise<T>(
  promise: Promise<T>,
  context: string,
  onRejected?: (error: unknown) => void,
): void {
  promise.catch((error: unknown) => {
    console.error(`[Promise] ${context} failed`, error)
    try {
      onRejected?.(error)
    } catch (observerError) {
      console.error(`[Promise] ${context} rejection observer failed`, observerError)
    }
  })
}
