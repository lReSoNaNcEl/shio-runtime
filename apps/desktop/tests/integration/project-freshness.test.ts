import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'vitest'

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
  failTree = false
  failCompare = false
  emptyTree = false
  headChecks = 0
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
    this.headChecks += 1
    if (this.failHead) throw new Error('network unavailable')
    return this.head
  }
  async listTree(): Promise<ProjectTreeEntry[]> {
    if (this.failTree) throw new Error('tree fetch failed')
    if (this.emptyTree) return []
    return [{ path: 'src/Runtime.ts', sha: this.head, size: 42, type: 'blob' }]
  }
  async readFile(path: string): Promise<ProjectSourceFile> {
    const content = 'export class Runtime { run(): void {} }'
    return { path, sha: this.head, size: content.length, language: 'typescript', content }
  }
  async compareCommits(): Promise<ProjectChangedFile[]> {
    if (this.failCompare) throw new Error('comparison unavailable')
    return this.changes
  }
  async listRecentCommits(): Promise<ProjectCommit[]> {
    return []
  }
}

async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'shio-project-freshness-'))
  const databasePath = join(directory, 'index.sqlite')
  let store = new ProjectKnowledgeStore(databasePath)
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
    const offlineStart = plugin.getStatus()
    assert.equal(offlineStart.snapshot, undefined)
    assert.equal(offlineStart.freshness.state, 'unknown')
    assert.equal(adapter.headChecks, 0)

    await plugin.sync()
    const fresh = plugin.getStatus()
    assert.equal(fresh.snapshot?.revision, FIRST_HEAD)
    assert.equal(fresh.freshness.remoteRevision, FIRST_HEAD)
    assert.equal(fresh.freshness.state, 'current')
    assert.deepEqual(plugin.getHealthPresentation(), {})

    adapter.head = SECOND_HEAD
    const stale = await plugin.refreshSnapshotStatus(true)
    assert.equal(stale.freshness.state, 'stale')
    assert.equal(stale.state, 'ready')
    assert.equal(stale.snapshot?.revision, FIRST_HEAD)
    assert.equal(stale.freshness.remoteRevision, SECOND_HEAD)
    assert.equal(stale.changedFiles?.total, 15)
    assert.equal(stale.changedFiles?.added, 3)
    assert.equal(stale.changedFiles?.modified, 9)
    assert.equal(stale.changedFiles?.deleted, 1)
    assert.equal(stale.changedFiles?.renamed, 2)
    assert.equal(stale.changedFiles?.files.length, 12)
    assert.equal(stale.changedFiles?.omitted, 3)
    assert.equal((await plugin.getHealth()).state, 'healthy')
    adapter.failCompare = true
    const staleWithoutChanges = await plugin.refreshSnapshotStatus(true)
    assert.equal(staleWithoutChanges.freshness.state, 'stale')
    assert.equal(staleWithoutChanges.changedFiles, undefined)
    const lastSuccessfulCheckAt = staleWithoutChanges.freshness.checkedAt
    adapter.failCompare = false

    const stalePacket = runtime.buildContextPacket({ query: 'Runtime architecture' })
    assert(stalePacket)
    assert.equal(stalePacket.snapshotSha, FIRST_HEAD)
    assert.equal(stalePacket.freshness, 'stale')

    adapter.failHead = true
    const failedCheck = await plugin.refreshSnapshotStatus(true)
    assert.equal(failedCheck.freshness.state, 'check-failed')
    assert.equal(failedCheck.freshness.reasonCode, 'network')
    assert.equal(failedCheck.state, 'ready')
    assert.equal(failedCheck.snapshot?.revision, FIRST_HEAD)
    assert.equal(failedCheck.freshness.lastKnownRemoteRevision, SECOND_HEAD)
    assert.equal(failedCheck.freshness.lastKnownRemoteCheckedAt, lastSuccessfulCheckAt)
    assert.equal((await plugin.getHealth()).state, 'healthy')
    const unknownPacket = runtime.buildContextPacket({ query: 'Runtime architecture' })
    assert.equal(unknownPacket?.snapshotSha, FIRST_HEAD)
    assert.equal(unknownPacket?.freshness, 'unknown')

    adapter.failHead = false
    adapter.failTree = true
    await assert.rejects(plugin.sync(), /tree fetch failed/)
    const failedSync = plugin.getStatus()
    assert.equal(failedSync.sync.state, 'failed')
    assert.equal(failedSync.snapshot?.revision, FIRST_HEAD)
    assert.equal(failedSync.freshness.state, 'stale')
    assert.equal(failedSync.freshness.remoteRevision, SECOND_HEAD)
    assert.equal((await plugin.getHealth()).state, 'healthy')

    adapter.failTree = false
    await plugin.sync()
    const synchronized = plugin.getStatus()
    assert.equal(synchronized.sync.state, 'idle')
    assert.equal(synchronized.snapshot?.revision, SECOND_HEAD)
    assert.equal(synchronized.freshness.state, 'current')

    const rebuilt = await plugin.rebuildIndex()
    assert.equal(rebuilt.commitSha, SECOND_HEAD)
    assert.equal(plugin.getStatus().snapshot?.revision, SECOND_HEAD)
    const activeAfterRebuild = store.getCurrentSnapshotByTarget('owner', 'project', 'main')?.id

    adapter.emptyTree = true
    await assert.rejects(plugin.rebuildIndex())
    const failedRebuild = plugin.getStatus()
    assert.equal(failedRebuild.snapshot?.revision, SECOND_HEAD)
    assert.equal(failedRebuild.sync.state, 'failed')
    const retainedSnapshot = store.getCurrentSnapshotByTarget('owner', 'project', 'main')
    assert.equal(retainedSnapshot?.snapshot.commitSha, SECOND_HEAD)
    assert.equal(retainedSnapshot?.id, activeAfterRebuild)

    await plugin.dispose()
    store.close()
    store = new ProjectKnowledgeStore(databasePath)
    const restarted = new ProjectAwarenessRuntime(
      { ...config, enabled: true },
      store,
      () => adapter,
    )
    restarted.setCredential('test-token-that-is-long-enough', {
      configured: true,
      source: 'secure_store',
      secureStorageAvailable: true,
    })
    await restarted.initialize()
    const afterRestart = restarted.getStatus()
    assert.equal(afterRestart.snapshot?.revision, SECOND_HEAD)
    assert.equal(afterRestart.freshness.state, 'unknown')
    assert.equal(afterRestart.freshness.lastKnownRemoteRevision, SECOND_HEAD)
  } finally {
    await plugin.dispose().catch(() => undefined)
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
  console.log('Project Snapshot Freshness focused repro: PASS')
}

describe('Project snapshot freshness integration', () => {
  it('preserves immutable snapshots across checks, sync failure, and rebuild', main)
})
