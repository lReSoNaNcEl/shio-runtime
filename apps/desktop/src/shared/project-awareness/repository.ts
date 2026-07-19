export type ProjectProvider = 'github'

export type ProjectLanguage =
  | 'typescript'
  | 'typescriptreact'
  | 'javascript'
  | 'javascriptreact'
  | 'python'
  | 'markdown'
  | 'json'
  | 'yaml'

export interface ProjectRepositoryIdentity {
  provider: ProjectProvider
  owner: string
  name: string
  defaultBranch: string
}

export interface ProjectSnapshotIdentity {
  repository: ProjectRepositoryIdentity
  branch: string
  commitSha: string
  createdAt: number
}

export interface ProjectSourceFile {
  path: string
  sha: string
  size: number
  language: ProjectLanguage
  content?: string
}

export interface ProjectConnectorStatus {
  state: 'disconnected' | 'connecting' | 'ready' | 'error'
  repository?: ProjectRepositoryIdentity
  branch?: string
  headSha?: string
  lastError?: string
}

export function isValidProjectRepository(value: string): boolean {
  return /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.test(value.trim())
}

export function isValidProjectBranch(value: string): boolean {
  const branch = value.trim()
  return (
    branch.length > 0 &&
    branch.length <= 255 &&
    !/[\s~^:?*[\]\\]/.test(branch) &&
    !branch.startsWith('.') &&
    !branch.startsWith('/') &&
    !branch.endsWith('.') &&
    !branch.endsWith('/') &&
    !branch.endsWith('.lock') &&
    !branch.includes('..') &&
    !branch.includes('@{') &&
    !branch.includes('//')
  )
}
