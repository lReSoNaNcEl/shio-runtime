export interface EventuallyOptions {
  intervalMs?: number
  timeoutMs?: number
}

export async function eventually(
  assertion: () => Promise<void> | void,
  options: EventuallyOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 1_000
  const intervalMs = options.intervalMs ?? 10
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  do {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))
  } while (Date.now() <= deadline)

  throw lastError
}
