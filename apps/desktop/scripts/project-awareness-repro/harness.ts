import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  extractSource,
  isAllowedProjectPath,
  isProjectRelevantRequest,
  isSafeTextContent,
  ProjectAwarenessRuntime,
  ProjectCredentialStore,
  ProjectKnowledgeStore,
} from '../../src/main/projectAwareness'
import type {
  ProjectChangedFile,
  ProjectCommit,
  ProjectRepositoryAdapter,
  ProjectTreeEntry,
} from '../../src/main/projectAwareness/contracts'
import { normalizeGitHubProjectError } from '../../src/main/projectAwareness/GitHubProjectAdapter'
import {
  isValidProjectBranch,
  isValidProjectRepository,
  type ProjectRepositoryIdentity,
  type ProjectSourceFile,
} from '../../src/shared/projectAwareness'

const sourceV1 = [
  "import { value } from './value'",
  'export interface RuntimeContract {',
  '  run(): void',
  '}',
  'export class ProjectRuntime {',
  '  sync(): void {}',
  '}',
].join('\n')

const sourceV2 = sourceV1.replaceAll('ProjectRuntime', 'ProjectRuntimeV2')

class MockRepositoryAdapter implements ProjectRepositoryAdapter {
  head = '1111111111111111111111111111111111111111'
  content = sourceV1
  owner = 'owner'
  name = 'repository'
  lastBranch = ''

  async getRepository(): Promise<ProjectRepositoryIdentity> {
    return {
      provider: 'github',
      owner: this.owner,
      name: this.name,
      defaultBranch: 'main',
    }
  }

  async getBranchHead(branch: string): Promise<string> {
    this.lastBranch = branch
    return this.head
  }

  async listTree(): Promise<ProjectTreeEntry[]> {
    return [
      {
        path: 'src/ProjectRuntime.ts',
        sha: this.head.slice(0, 40),
        size: Buffer.byteLength(this.content),
        type: 'blob',
      },
    ]
  }

  async readFile(path: string): Promise<ProjectSourceFile> {
    return {
      path,
      sha: this.head.slice(0, 40),
      size: Buffer.byteLength(this.content),
      language: 'typescript',
      content: this.content,
    }
  }

  async compareCommits(): Promise<ProjectChangedFile[]> {
    return [{ path: 'src/ProjectRuntime.ts', status: 'modified' }]
  }

  async listRecentCommits(): Promise<ProjectCommit[]> {
    return [
      {
        sha: this.head,
        message: 'update project runtime',
        authoredAt: 1,
        parentShas: ['0000000000000000000000000000000000000000'],
      },
    ]
  }
}

async function main(): Promise<void> {
  assert.equal(
    isAllowedProjectPath({ path: 'apps/desktop/src/main/index.ts', size: 100 }, 1024),
    true,
  )
  assert.equal(isAllowedProjectPath({ path: '.env.local', size: 10 }, 1024), false)
  assert.equal(
    isAllowedProjectPath({ path: 'node_modules/package/index.ts', size: 10 }, 1024),
    false,
  )
  assert.equal(isAllowedProjectPath({ path: 'src/large.ts', size: 2048 }, 1024), false)
  assert.equal(isSafeTextContent('const safe = true\n'), true)
  assert.equal(isSafeTextContent('binary\0content'), false)
  assert.equal(isValidProjectRepository('owner/repository'), true)
  assert.equal(isValidProjectRepository('repository-only'), false)
  assert.equal(isValidProjectBranch('feature/project-awareness'), true)
  assert.equal(isValidProjectBranch('feature branch'), false)

  const extracted = extractSource('src/ProjectRuntime.ts', 'typescript', sourceV1)
  assert(extracted.imports.includes('./value'))
  assert(extracted.symbols.some((symbol) => symbol.name === 'RuntimeContract'))
  assert(extracted.symbols.some((symbol) => symbol.name === 'ProjectRuntime.sync'))
  assert(extracted.chunks.some((chunk) => chunk.symbolName === 'ProjectRuntime'))
  assert.equal(isProjectRelevantRequest('Как работает ProjectRuntime?'), true)
  assert.equal(isProjectRelevantRequest('Расскажи короткую шутку'), false)
  const privateRepositoryError = normalizeGitHubProjectError(
    { isAxiosError: true, response: { status: 404 } },
    'owner/repository',
    false,
  )
  assert.match(privateRepositoryError.message, /Connect GitHub/)
  const inaccessibleRepositoryError = normalizeGitHubProjectError(
    { isAxiosError: true, response: { status: 404 } },
    'owner/repository',
    true,
  )
  assert.match(inaccessibleRepositoryError.message, /cannot access private repository/)

  const directory = mkdtempSync(join(tmpdir(), 'shio-project-awareness-'))
  const credentialPath = join(directory, 'github-credential.bin')
  const credentialProtector = {
    async isAvailable(): Promise<boolean> {
      return true
    },
    async encrypt(value: string): Promise<Buffer> {
      return Buffer.from(`protected:${Buffer.from(value).toString('base64')}`)
    },
    async decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }> {
      if (!value.toString().startsWith('protected:')) throw new Error('invalid protected data')
      return {
        result: Buffer.from(value.toString().replace('protected:', ''), 'base64').toString(),
        shouldReEncrypt: false,
      }
    },
  }
  const credentialStore = new ProjectCredentialStore(credentialPath, credentialProtector)
  const savedCredential = await credentialStore.save('test-token-value-that-is-long-enough')
  assert.equal(savedCredential.source, 'secure_store')
  assert.equal(readFileSync(credentialPath).includes('test-token-value-that-is-long-enough'), false)
  const loadedCredential = await credentialStore.load()
  assert.equal(loadedCredential.token, 'test-token-value-that-is-long-enough')
  assert.equal(loadedCredential.configured, true)
  const clearedCredential = await credentialStore.clear()
  assert.equal(clearedCredential.source, 'none')
  assert.equal(clearedCredential.configured, false)
  writeFileSync(credentialPath, 'broken credential data')
  const brokenCredential = await credentialStore.load()
  assert.equal(brokenCredential.configured, false)
  assert.match(brokenCredential.lastError ?? '', /could not be decrypted/)

  const store = new ProjectKnowledgeStore(join(directory, 'project-index.sqlite'))
  const adapter = new MockRepositoryAdapter()
  let receivedToken = ''
  let receivedOwner = ''
  let receivedName = ''
  const runtime = new ProjectAwarenessRuntime(
    {
      enabled: true,
      provider: 'github',
      repository: 'owner/repository',
      branch: 'main',
      maxFileSizeBytes: 256 * 1024,
    },
    store,
    (owner, name, token) => {
      receivedToken = token
      receivedOwner = owner
      receivedName = name
      adapter.owner = owner
      adapter.name = name
      return adapter
    },
  )
  runtime.setCredential('secret-token-that-is-long-enough', {
    configured: true,
    source: 'secure_store',
    secureStorageAvailable: true,
  })

  try {
    await runtime.connect()
    const first = await runtime.sync()
    assert.equal(first.status, 'indexed')
    assert.equal(receivedToken, 'secret-token-that-is-long-enough')
    assert.equal(JSON.stringify(runtime.getStatus()).includes('secret-token'), false)
    assert.equal(runtime.getStatus().credential.source, 'secure_store')
    assert.equal(runtime.getStatus().indexedFileCount, 1)
    assert(runtime.getProjectMap())
    assert.equal(runtime.search({ query: 'ProjectRuntime' })[0]?.symbol, 'ProjectRuntime')
    assert.equal(runtime.readSymbol({ name: 'ProjectRuntime' }).startLine, 5)

    adapter.head = '2222222222222222222222222222222222222222'
    adapter.content = sourceV2
    const second = await runtime.sync()
    assert.equal(second.status, 'indexed')
    assert.equal(second.changedFiles, 1)
    assert.equal(runtime.readSymbol({ name: 'ProjectRuntimeV2' }).commitSha, adapter.head)

    const context = runtime.buildContextPacket('Почему ProjectRuntimeV2 синхронизирует проект?')
    assert(context)
    assert.equal(context.snapshotSha, adapter.head)
    assert(context.evidence.length > 0)

    const recent = await runtime.getRecentChanges({ limit: 1 })
    assert.equal(recent.commits[0]?.changedFiles[0], 'src/ProjectRuntime.ts')

    const reconfigured = await runtime.configure({
      enabled: true,
      provider: 'github',
      repository: 'another/project',
      branch: 'feature/project-awareness',
    })
    assert.equal(reconfigured.repository, 'another/project')
    assert.equal(reconfigured.branch, 'feature/project-awareness')
    assert.equal(receivedOwner, 'another')
    assert.equal(receivedName, 'project')
    assert.equal(adapter.lastBranch, 'feature/project-awareness')

    const disabled = await runtime.configure({
      enabled: false,
      provider: 'github',
      repository: 'another/project',
      branch: 'feature/project-awareness',
    })
    assert.equal(disabled.enabled, false)
    assert.equal(disabled.state, 'disconnected')
  } finally {
    store.close()
    const resolvedDirectory = join(directory)
    assert(resolvedDirectory.startsWith(tmpdir()))
    rmSync(resolvedDirectory, { recursive: true, force: true })
  }

  console.log('Project Awareness repro: PASS')
}

void main()
