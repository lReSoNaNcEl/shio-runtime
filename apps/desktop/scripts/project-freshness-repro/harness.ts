import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PluginInitializationContext } from '../../src/main/plugins'
import {
  type ProjectAwarenessConfigStore,
  ProjectAwarenessPlugin,
  ProjectAwarenessRuntime,
  type ProjectCredentialStore,
  ProjectKnowledgeStore,
} from '../../src/main/project-awareness'
import type {
  ProjectChangedFile,
  ProjectCommit,
  ProjectRepositoryAdapter,
  ProjectTreeEntry,
} from '../../src/main/project-awareness/contracts'
import type {
  ProjectAwarenessPublicConfig,
  ProjectRepositoryIdentity,
  ProjectSourceFile,
} from '../../src/shared/project-awareness'

const FIRST_HEAD = '1111111111111111111111111111111111111111'
const SECOND_HEAD = '2222222222222222222222222222222222222222'

class FreshnessAdapter implements ProjectRepositoryAdapter {
  head = FIRST_HEAD
  failHead = false
  readonly changes: ProjectChangedFile[] = Array.from({ length: 15 }, (_, index) => ({
    path: `src/file-${String(index).padStart(2, '0')}.ts`,
    status:
      index < 3
        ? ('added' as const)
        : index < 12
          ? ('modified' as const)
          : index === 12
            ? ('removed' as const)
            : ('renamed' as const),
  }))

  async getRepository(): Promise<ProjectRepositoryIdentity> {
    return { provider: 'github', owner: 'owner', name: 'project', defaultBranch: 'main' }
  }
  async getBranchHead(): Promise<string> {
    if (this.failHead) throw new Error('network unavailable')
    return this.head
  }
  async listTree(): Promise<ProjectTreeEntry[]> {
    return [{ path: 'src/Runtime.ts', sha: this.head, size: 42, type: 'blob' }]
  }
  async readFile(path: string): Promise<ProjectSourceFile> {
    const content = 'export class Runtime { run(): void {} }'
    return { path, sha: this.head, size: content.length, language: 'typescript', content }
  }
  async compareCommits(): Promise<ProjectChangedFile[]> {
    return this.changes
  }
  async listRecentCommits(): Promise<ProjectCommit[]> {
    return []
  }
}

async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'shio-project-freshness-'))
  const store = new ProjectKnowledgeStore(join(directory, 'index.sqlite'))
  const adapter = new FreshnessAdapter()
  const config: ProjectAwarenessPublicConfig & { maxFileSizeBytes: number } = {
    provider: 'github',
    repository: 'owner/project',
    branch: 'main',
    maxFileSizeBytes: 256 * 1024,
  }
  const runtime = new ProjectAwarenessRuntime({ ...config, enabled: false }, store, () => adapter)
  const plugin = new ProjectAwarenessPlugin({
    config: {
      load: async () => ({ schemaVersion: 1, ...config }),
    } as unknown as ProjectAwarenessConfigStore,
    credentials: {
      load: async () => ({
        token: 'test-token-that-is-long-enough',
        configured: true,
        source: 'secure_store' as const,
        secureStorageAvailable: true,
      }),
    } as unknown as ProjectCredentialStore,
    createRuntime: () => runtime,
    closeStore: () => undefined,
  })

  try {
    await plugin.initialize({ pluginId: 'project-awareness' } as PluginInitializationContext)
    await plugin.start()
    const fresh = plugin.getStatus()
    assert.equal(fresh.indexedCommit, FIRST_HEAD)
    assert.equal(fresh.remoteHead, FIRST_HEAD)
    assert.equal(fresh.freshness, 'fresh')

    adapter.head = SECOND_HEAD
    const stale = await plugin.refreshSnapshotStatus(true)
    assert.equal(stale.freshness, 'stale')
    assert.equal(stale.state, 'ready')
    assert.equal(stale.indexedCommit, FIRST_HEAD)
    assert.equal(stale.remoteHead, SECOND_HEAD)
    assert.equal(stale.snapshotDelta?.total, 15)
    assert.equal(stale.snapshotDelta?.added, 3)
    assert.equal(stale.snapshotDelta?.modified, 9)
    assert.equal(stale.snapshotDelta?.deleted, 1)
    assert.equal(stale.snapshotDelta?.renamed, 2)
    assert.equal(stale.snapshotDelta?.files.length, 12)
    assert.equal(stale.snapshotDelta?.omitted, 3)
    assert.equal((await plugin.getHealth()).state, 'healthy')

    const stalePacket = runtime.buildContextPacket('Как работает Runtime?')
    assert(stalePacket)
    assert.equal(stalePacket.snapshotSha, FIRST_HEAD)
    assert.equal(stalePacket.freshness, 'stale')

    adapter.failHead = true
    const unknown = await plugin.refreshSnapshotStatus(true)
    assert.equal(unknown.freshness, 'unknown')
    assert.equal(unknown.state, 'ready')
    assert.equal(unknown.indexedCommit, FIRST_HEAD)
    assert.equal((await plugin.getHealth()).state, 'healthy')
    assert.equal(runtime.buildContextPacket('Как работает Runtime?')?.snapshotSha, FIRST_HEAD)
  } finally {
    await plugin.dispose()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
  console.log('Project Snapshot Freshness focused repro: PASS')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
