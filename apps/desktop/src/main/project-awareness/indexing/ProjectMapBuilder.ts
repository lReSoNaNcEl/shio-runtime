import { posix } from 'node:path'

import type {
  ProjectFlowSummary,
  ProjectMap,
  ProjectMapSection,
  ProjectRuntimeSummary,
  ProjectSnapshotIdentity,
} from '../../../shared/project-awareness'
import type { StoredProjectFile, StoredProjectSymbol } from '../ProjectKnowledgeStore'

function sectionName(path: string): string {
  const segments = path.split('/')
  return segments.length > 1 ? segments.slice(0, 2).join('/') : 'repository root'
}

function buildArchitecture(files: StoredProjectFile[]): ProjectMapSection[] {
  const sections = new Map<string, string[]>()
  for (const file of files) {
    const name = sectionName(file.path)
    const paths = sections.get(name) ?? []
    if (paths.length < 12) paths.push(file.path)
    sections.set(name, paths)
  }
  return [...sections.entries()]
    .map(([name, paths]) => ({ name, paths }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function buildRuntimeSystems(
  files: StoredProjectFile[],
  symbols: Array<StoredProjectSymbol & { path: string }>,
): ProjectRuntimeSummary[] {
  return files
    .filter((file) => /(?:Runtime|orchestrator|Admission|Adapter)\.(?:ts|tsx)$/i.test(file.path))
    .slice(0, 30)
    .map((file) => ({
      name: posix.basename(file.path).replace(/\.[^.]+$/, ''),
      path: file.path,
      exportedSymbols: symbols
        .filter((symbol) => symbol.path === file.path && symbol.exported)
        .slice(0, 8)
        .map((symbol) => symbol.name),
    }))
}

function buildFlows(files: StoredProjectFile[]): ProjectFlowSummary[] {
  const paths = new Set(files.map((file) => file.path))
  const candidates: ProjectFlowSummary[] = [
    {
      name: 'Desktop main → IPC → preload → renderer',
      files: [
        'apps/desktop/src/main/index.ts',
        'apps/desktop/src/main/ipc.ts',
        'apps/desktop/src/preload/index.ts',
        'apps/desktop/src/renderer/Controller.ts',
      ],
    },
    {
      name: 'Conversation admission → response generation → speech',
      files: [
        'apps/desktop/src/renderer/conversation/admission/ConversationAdmissionCoordinator.ts',
        'apps/desktop/src/renderer/runtime/ConversationRuntime.ts',
        'apps/desktop/src/main/orchestrator.ts',
        'apps/desktop/src/renderer/runtime/SpeechRuntime.ts',
      ],
    },
    {
      name: 'Project repository → index → grounded context',
      files: [
        'apps/desktop/src/main/project-awareness/adapters/GitHubProjectAdapter.ts',
        'apps/desktop/src/main/project-awareness/ProjectAwarenessRuntime.ts',
        'apps/desktop/src/main/project-awareness/ProjectKnowledgeStore.ts',
      ],
    },
  ]
  return candidates
    .map((flow) => ({ ...flow, files: flow.files.filter((path) => paths.has(path)) }))
    .filter((flow) => flow.files.length > 0)
}

function extractOwnershipRules(files: StoredProjectFile[]): string[] {
  const architecture = files.find((file) => file.path === 'ARCHITECTURE.md')
  if (!architecture) return []
  return architecture.content
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter(
      (line) =>
        line.length >= 20 &&
        line.length <= 240 &&
        /(?:only|never|single source of truth|one responsibility|must not)/i.test(line),
    )
    .slice(0, 12)
}

export function buildProjectMap(
  snapshot: ProjectSnapshotIdentity,
  files: StoredProjectFile[],
  symbols: Array<StoredProjectSymbol & { path: string }>,
): ProjectMap {
  const repository = `${snapshot.repository.owner}/${snapshot.repository.name}`
  return {
    snapshot,
    overview: `${repository} at ${snapshot.branch}@${snapshot.commitSha.slice(0, 7)}; ${files.length} indexed source files across ${new Set(files.map((file) => sectionName(file.path))).size} project sections.`,
    architecture: buildArchitecture(files),
    runtimeSystems: buildRuntimeSystems(files, symbols),
    keyFlows: buildFlows(files),
    keyFiles: files.slice(0, 16).map((file) => ({
      path: file.path,
      reason:
        file.path === 'ARCHITECTURE.md'
          ? 'Canonical architecture source of truth'
          : file.priority >= 700
            ? 'Canonical project or Runtime contract'
            : 'High-priority indexed source',
    })),
    ownershipRules: extractOwnershipRules(files),
    importantSymbols: symbols
      .filter((symbol) => symbol.exported)
      .slice(0, 80)
      .map((symbol) => ({
        path: symbol.path,
        name: symbol.name,
        kind: symbol.kind,
        startLine: symbol.start_line,
        endLine: symbol.end_line,
      })),
  }
}

export function summarizeProjectMap(map: ProjectMap): string {
  const runtimes = map.runtimeSystems
    .slice(0, 12)
    .map((runtime) => `${runtime.name} (${runtime.path})`)
    .join('; ')
  const keyFiles = map.keyFiles
    .slice(0, 8)
    .map((file) => file.path)
    .join(', ')
  return [map.overview, runtimes ? `Runtime systems: ${runtimes}.` : '', `Key files: ${keyFiles}.`]
    .filter(Boolean)
    .join('\n')
}
