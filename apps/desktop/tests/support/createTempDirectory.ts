import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TestTempDirectory {
  readonly path: string
  cleanup(): Promise<void>
}

export async function createTempDirectory(
  prefix = 'shio-desktop-test-',
): Promise<TestTempDirectory> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  let cleaned = false
  return {
    path,
    async cleanup() {
      if (cleaned) return
      cleaned = true
      await rm(path, { force: true, recursive: true, maxRetries: 3, retryDelay: 50 })
    },
  }
}
