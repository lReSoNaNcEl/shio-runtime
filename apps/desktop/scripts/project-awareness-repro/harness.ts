import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  extractSource,
  isAllowedProjectPath,
  isProjectRelevantRequest,
  isSafeTextContent,
  ProjectAwarenessRuntime,
  ProjectCredentialStore,
  ProjectKnowledgeStore,
} from '../../src/main/project-awareness'
import { normalizeGitHubProjectError } from '../../src/main/project-awareness/adapters/GitHubProjectAdapter'
import type {
  ProjectChangedFile,
  ProjectCommit,
  ProjectRepositoryAdapter,
  ProjectTreeEntry,
} from '../../src/main/project-awareness/contracts'
import { sourcePriority } from '../../src/main/project-awareness/indexing/SourceFilter'
import { type Translator, translate } from '../../src/shared/localization'
import {
  isValidProjectBranch,
  isValidProjectRepository,
  type ProjectRepositoryIdentity,
  type ProjectSourceFile,
} from '../../src/shared/project-awareness'

const sourceV1 = [
  "import { value } from './value'",
  'export interface RuntimeContract {',
  '  run(): void',
  '}',
  'export class ProjectRuntime {',
  '  sync(): void {}',
  '}',
].join('\n')

const translateEnglish: Translator = (key, params) => translate('en', key, params)

const sourceV2 = sourceV1.replaceAll('ProjectRuntime', 'ProjectRuntimeV2')
const sourceV3 = sourceV1.replaceAll('ProjectRuntime', 'ProjectRuntimeV3')
const stableSource = [
  'export const stableProjectValue = 42',
  'export type StableProjectValue = number',
].join('\n')

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
      {
        path: 'src/stable.ts',
        sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        size: Buffer.byteLength(stableSource),
        type: 'blob',
      },
    ]
  }

  async readFile(path: string): Promise<ProjectSourceFile> {
    const content = path === 'src/stable.ts' ? stableSource : this.content
    return {
      path,
      sha:
        path === 'src/stable.ts'
          ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
          : this.head.slice(0, 40),
      size: Buffer.byteLength(content),
      language: 'typescript',
      content,
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
  assert.equal(sourcePriority('AGENTS.md'), 950)
  assert.equal(sourcePriority('CLAUDE.md'), 100)

  const extracted = extractSource('src/ProjectRuntime.ts', 'typescript', sourceV1)
  assert(extracted.imports.includes('./value'))
  assert(extracted.symbols.some((symbol) => symbol.name === 'RuntimeContract'))
  assert(extracted.symbols.some((symbol) => symbol.name === 'ProjectRuntime.sync'))
  assert(extracted.chunks.some((chunk) => chunk.symbolName === 'ProjectRuntime'))

  const typescriptSyntaxFixture = [
    "import type { RuntimeEvent } from './events'",
    '',
    'export const PROFILES = {',
    "  default: { id: 'default' },",
    '} as const satisfies Record<string, { id: string }>',
    '',
    'export type ProfileId = keyof typeof PROFILES',
    '',
    'export class SyntaxRuntime {',
    '  private readonly entries = new Map<',
    '    string,',
    '    { event: RuntimeEvent; createdAt: number }',
    '  >()',
    '',
    '  get(): RuntimeEvent | undefined {',
    '    return this.entries.get("current")?.event',
    '  }',
    '',
    '  set(event: RuntimeEvent): void {',
    '    this.entries.set("current", { event, createdAt: Date.now() })',
    '  }',
    '',
    '  snapshot(): Promise<{ event: RuntimeEvent | undefined }> {',
    '    return Promise.resolve({ event: this.get() })',
    '  }',
    '}',
    '',
    'export function templateExpression(value: string): string {',
    '  return `' + '$' + "{value.replace(/\"/g, 'x')}`",
    '}',
  ].join('\n')
  const typescriptSyntaxExtracted = extractSource(
    'src/SyntaxRuntime.ts',
    'typescript',
    typescriptSyntaxFixture,
  )
  assert.deepEqual(typescriptSyntaxExtracted.imports, ['./events'])
  assert.deepEqual(
    typescriptSyntaxExtracted.symbols.map((symbol) => symbol.name),
    [
      'PROFILES',
      'ProfileId',
      'SyntaxRuntime',
      'SyntaxRuntime.get',
      'SyntaxRuntime.set',
      'SyntaxRuntime.snapshot',
      'templateExpression',
    ],
  )
  assert.equal(
    typescriptSyntaxExtracted.symbols.find((symbol) => symbol.name === 'SyntaxRuntime.snapshot')
      ?.endLine,
    25,
  )

  const pythonSource = [
    '"""def NotAFunction(): pass"""',
    '# class NotAClass:',
    'from ..package.tools import helper',
    'import asyncio, package.client as client',
    '',
    'PUBLIC_LIMIT: Final[int] = 3',
    '',
    '@register',
    'class Worker(Base):',
    '    @trace',
    '    async def run(',
    '        self,',
    '        value: int = 1,',
    '    ) -> str:',
    '        def nested():',
    '            return "nested"',
    '        return str(value)',
    '',
    '    def _private(self):',
    '        return None',
    '',
    '@decorator',
    'def top_level(first, second=2):',
    '    return first + second',
    '',
    'if TYPE_CHECKING:',
    '    def conditional_only():',
    '        pass',
  ].join('\n')
  const pythonExtracted = extractSource('app/runtime.py', 'python', pythonSource)
  assert.deepEqual(pythonExtracted.imports, ['..package.tools', 'asyncio', 'package.client'])
  assert.deepEqual(
    pythonExtracted.symbols.map((symbol) => symbol.name),
    ['PUBLIC_LIMIT', 'Worker', 'Worker.run', 'Worker._private', 'top_level'],
  )
  const pythonRun = pythonExtracted.symbols.find((symbol) => symbol.name === 'Worker.run')
  assert.equal(pythonRun?.startLine, 10)
  assert.equal(pythonRun?.endLine, 17)
  assert.match(pythonRun?.signature ?? '', /^async def run\(/)
  assert.match(pythonRun?.signature ?? '', /\) -> str$/)
  assert.equal(
    pythonExtracted.symbols.some((symbol) => symbol.name.includes('NotA')),
    false,
  )
  assert.equal(
    pythonExtracted.symbols.some((symbol) => symbol.name.includes('nested')),
    false,
  )
  assert.equal(
    pythonExtracted.symbols.some((symbol) => symbol.name.includes('conditional_only')),
    false,
  )
  assert(
    pythonExtracted.chunks.some(
      (chunk) => chunk.symbolName === 'Worker' && chunk.content.includes('async def run'),
    ),
  )

  const longPythonClass = [
    'class LargeRuntime:',
    ...['first', 'second', 'third'].flatMap((name) => [
      `    def ${name}(self):`,
      ...Array.from({ length: 90 }, (_, index) => `        value_${index} = ${index}`),
      `        return "${name}"`,
    ]),
  ].join('\n')
  const longPythonExtracted = extractSource('app/large_runtime.py', 'python', longPythonClass)
  const longPythonMethods = longPythonExtracted.symbols.filter((symbol) => symbol.kind === 'method')
  assert.equal(longPythonMethods.length, 3)
  for (const method of longPythonMethods) {
    const overlappingChunks = longPythonExtracted.chunks.filter(
      (chunk) => chunk.startLine <= method.endLine && chunk.endLine >= method.startLine,
    )
    assert.equal(overlappingChunks.length, 1, `${method.name} must stay in one AST chunk`)
  }
  assert(longPythonExtracted.chunks.every((chunk) => chunk.endLine - chunk.startLine + 1 <= 220))
  assert.equal(isProjectRelevantRequest('Как работает ProjectRuntime?'), true)
  assert.equal(isProjectRelevantRequest('Расскажи короткую шутку'), false)
  const privateRepositoryError = normalizeGitHubProjectError(
    { isAxiosError: true, response: { status: 404 } },
    'owner/repository',
    false,
    translateEnglish,
  )
  assert.match(privateRepositoryError.message, /Save a token/)
  const inaccessibleRepositoryError = normalizeGitHubProjectError(
    { isAxiosError: true, response: { status: 404 } },
    'owner/repository',
    true,
    translateEnglish,
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
  const credentialStore = new ProjectCredentialStore(
    credentialPath,
    credentialProtector,
    translateEnglish,
  )
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

  const databasePath = join(directory, 'project-index.sqlite')
  const store = new ProjectKnowledgeStore(databasePath, translateEnglish)
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
    translateEnglish,
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
    assert.equal(runtime.getStatus().indexedFileCount, 2)
    assert(runtime.getProjectMap())
    assert.equal(runtime.search({ query: 'ProjectRuntime' })[0]?.symbol, 'ProjectRuntime')
    assert.equal(runtime.readSymbol({ name: 'ProjectRuntime' }).startLine, 5)

    adapter.head = '2222222222222222222222222222222222222222'
    adapter.content = sourceV2
    const second = await runtime.sync()
    assert.equal(second.status, 'indexed')
    assert.equal(second.changedFiles, 1)
    assert.equal(runtime.readSymbol({ name: 'ProjectRuntimeV2' }).commitSha, adapter.head)

    adapter.head = '3333333333333333333333333333333333333333'
    adapter.content = sourceV3
    const third = await runtime.sync()
    assert.equal(third.status, 'indexed')
    assert.equal(third.changedFiles, 1)
    assert.equal(runtime.getStatus().indexedCommit, adapter.head)
    assert.equal(runtime.search({ query: 'ProjectRuntimeV3' })[0]?.symbol, 'ProjectRuntimeV3')
    assert.equal(runtime.readFile({ path: 'src/stable.ts' }).content, stableSource)

    const inspection = new DatabaseSync(databasePath)
    try {
      const snapshotCount = inspection
        .prepare(
          `SELECT COUNT(*) AS count
           FROM snapshots
           WHERE repository_id = ? AND branch = ?`,
        )
        .get('github:owner/repository', 'main') as { count: number }
      assert(snapshotCount.count <= 2)
      const retainedSnapshots = inspection
        .prepare(
          `SELECT commit_sha
           FROM snapshots
           WHERE repository_id = ? AND branch = ?
           ORDER BY commit_sha`,
        )
        .all('github:owner/repository', 'main') as unknown as Array<{ commit_sha: string }>
      assert.deepEqual(
        retainedSnapshots.map((snapshot) => snapshot.commit_sha),
        ['2222222222222222222222222222222222222222', '3333333333333333333333333333333333333333'],
      )
      const prunedFtsCount = inspection
        .prepare('SELECT COUNT(*) AS count FROM chunks_fts WHERE snapshot_id = ?')
        .get('github:owner/repository:main:1111111111111111111111111111111111111111') as {
        count: number
      }
      assert.equal(prunedFtsCount.count, 0)
    } finally {
      inspection.close()
    }

    const context = runtime.buildContextPacket('Почему ProjectRuntimeV3 синхронизирует проект?')
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
