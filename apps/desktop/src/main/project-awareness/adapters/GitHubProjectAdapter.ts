import { request as octokitRequest } from '@octokit/request'

import { DEFAULT_UI_LOCALE, type Translator, translate } from '../../../shared/localization'
import type {
  ProjectRepositoryIdentity,
  ProjectSourceFile,
} from '../../../shared/project-awareness'
import { createObservedFetch } from '../../diagnostics/createObservedFetch'
import type {
  ProjectChangedFile,
  ProjectCommit,
  ProjectRepositoryAdapter,
  ProjectTreeEntry,
} from '../contracts'
import { projectLanguageForPath } from '../indexing/SourceFilter'

interface GitHubRepositoryResponse {
  default_branch?: string
}

interface GitHubCommitResponse {
  sha?: string
  commit?: {
    message?: string
    author?: { date?: string }
  }
  parents?: Array<{ sha?: string }>
}

interface GitHubTreeResponse {
  truncated?: boolean
  tree?: Array<{ path?: string; mode?: string; type?: string; sha?: string; size?: number }>
}

interface GitHubContentResponse {
  type?: string
  sha?: string
  size?: number
  encoding?: string
  content?: string
}

interface GitHubCompareResponse {
  files?: Array<{
    filename?: string
    previous_filename?: string
    status?: string
  }>
}

export function normalizeGitHubProjectError(
  error: unknown,
  repository: string,
  hasToken: boolean,
  t: Translator = (key, params) => translate(DEFAULT_UI_LOCALE, key, params),
): Error {
  const status = githubErrorStatus(error)
  if (status === undefined) {
    if (isOctokitTransportError(error)) return new Error(t('main.error.github.network'))
    return error instanceof Error ? error : new Error(String(error))
  }
  if (status === 404) {
    return new Error(
      hasToken
        ? t('main.error.github.privateToken', { repository })
        : t('main.error.github.privateAnonymous', { repository }),
    )
  }
  if (status === 401) {
    return new Error(t('main.error.github.unauthorized'))
  }
  if (status === 403) {
    return new Error(
      hasToken ? t('main.error.github.forbiddenToken') : t('main.error.github.forbiddenAnonymous'),
    )
  }
  return new Error(
    status ? t('main.error.github.http', { status }) : t('main.error.github.network'),
  )
}

function githubErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as { name?: unknown; status?: unknown; response?: { status?: unknown } }
  if (candidate.name === 'HttpError' && !candidate.response) return undefined
  const status = candidate.status ?? candidate.response?.status
  return typeof status === 'number' ? status : undefined
}

function isOctokitTransportError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      ((error as { name?: unknown }).name === 'HttpError' ||
        (error as { name?: unknown }).name === 'AbortError'),
  )
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function normalizeChangedStatus(status: string | undefined): ProjectChangedFile['status'] {
  switch (status) {
    case 'added':
    case 'removed':
    case 'renamed':
      return status
    default:
      return 'modified'
  }
}

export class GitHubProjectAdapter implements ProjectRepositoryAdapter {
  private readonly request: ReturnType<typeof octokitRequest.defaults>
  private readonly fetchImpl: typeof fetch
  private readonly repository: string
  private readonly hasToken: boolean
  private readonly treeBlobs = new Map<string, { sha: string; size: number }>()

  constructor(
    private readonly owner: string,
    private readonly name: string,
    private readonly tokenValue: string,
    private readonly t: Translator = (key, params) => translate(DEFAULT_UI_LOCALE, key, params),
    fetchImpl: typeof fetch = fetch,
  ) {
    this.repository = `${owner}/${name}`
    this.hasToken = Boolean(this.tokenValue)
    this.fetchImpl = createObservedFetch(fetchImpl, 'project-awareness')
    this.request = octokitRequest.defaults({
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'Shio-Project-Awareness',
        ...(this.tokenValue ? { authorization: `Bearer ${this.tokenValue}` } : {}),
      },
      request: { fetch: this.fetchImpl },
    })
  }

  async getRepository(): Promise<ProjectRepositoryIdentity> {
    const data = await this.api<GitHubRepositoryResponse>('GET /repos/{owner}/{repo}', {
      owner: this.owner,
      repo: this.name,
    })
    if (!data.default_branch) {
      throw new Error(this.t('main.error.github.defaultBranchMissing'))
    }
    return {
      provider: 'github',
      owner: this.owner,
      name: this.name,
      defaultBranch: data.default_branch,
    }
  }

  async getBranchHead(branch: string): Promise<string> {
    const data = await this.api<GitHubCommitResponse>('GET /repos/{owner}/{repo}/commits/{ref}', {
      owner: this.owner,
      repo: this.name,
      ref: branch,
    })
    if (!data.sha) throw new Error(this.t('main.error.github.commitMissing'))
    return data.sha
  }

  async listTree(commitSha: string): Promise<ProjectTreeEntry[]> {
    const data = await this.api<GitHubTreeResponse>(
      'GET /repos/{owner}/{repo}/git/trees/{tree_sha}',
      { owner: this.owner, repo: this.name, tree_sha: commitSha, recursive: '1' },
    )
    if (data.truncated) {
      throw new Error(this.t('main.error.github.treeTruncated'))
    }
    const tree = (data.tree ?? []).flatMap((entry) => {
      if (
        entry.type !== 'blob' ||
        typeof entry.path !== 'string' ||
        typeof entry.sha !== 'string'
      ) {
        return []
      }
      return [
        {
          path: entry.path,
          sha: entry.sha,
          size: entry.size ?? 0,
          type: 'blob' as const,
        },
      ]
    })
    this.treeBlobs.clear()
    for (const entry of tree) {
      this.treeBlobs.set(entry.path, { sha: entry.sha, size: entry.size })
    }
    return tree
  }

  async readFile(path: string, commitSha: string): Promise<ProjectSourceFile> {
    const language = projectLanguageForPath(path)
    if (!language) throw new Error(this.t('main.error.github.unsupportedLanguage', { path }))
    const treeBlob = this.treeBlobs.get(path)
    try {
      const rawUrl = new URL(
        `${encodeURIComponent(commitSha)}/${encodePath(path)}`,
        `https://raw.githubusercontent.com/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.name)}/`,
      )
      const response = await this.fetchImpl(rawUrl, {
        headers: this.hasToken ? { Authorization: `Bearer ${this.tokenValue}` } : undefined,
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok)
        throw Object.assign(new Error(`GitHub raw HTTP ${response.status}`), {
          status: response.status,
        })
      const content = await response.text()
      return {
        path,
        sha: treeBlob?.sha ?? commitSha,
        size: treeBlob?.size ?? Buffer.byteLength(content, 'utf8'),
        language,
        content,
      }
    } catch {
      // Private repositories and enterprise policies may reject the raw host.
      // Fall back to the authenticated GitHub Contents API while preserving the
      // same read-only Adapter contract.
    }
    const data = await this.api<GitHubContentResponse>(
      'GET /repos/{owner}/{repo}/contents/{path}',
      { owner: this.owner, repo: this.name, path, ref: commitSha },
    )
    if (
      data.type !== 'file' ||
      typeof data.sha !== 'string' ||
      data.encoding !== 'base64' ||
      typeof data.content !== 'string'
    ) {
      throw new Error(this.t('main.error.github.unsupportedContent', { path }))
    }
    return {
      path,
      sha: data.sha,
      size: data.size ?? 0,
      language,
      content: Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8'),
    }
  }

  async compareCommits(baseSha: string, headSha: string): Promise<ProjectChangedFile[]> {
    const data = await this.api<GitHubCompareResponse>(
      'GET /repos/{owner}/{repo}/compare/{basehead}',
      { owner: this.owner, repo: this.name, basehead: `${baseSha}...${headSha}` },
    )
    return (data.files ?? []).flatMap((file) => {
      if (!file.filename) return []
      return [
        {
          path: file.filename,
          previousPath: file.previous_filename,
          status: normalizeChangedStatus(file.status),
        },
      ]
    })
  }

  async listRecentCommits(branch: string, limit: number): Promise<ProjectCommit[]> {
    const data = await this.api<GitHubCommitResponse[]>('GET /repos/{owner}/{repo}/commits', {
      owner: this.owner,
      repo: this.name,
      sha: branch,
      per_page: Math.max(1, Math.min(20, limit)),
    })
    return data.flatMap((commit) => {
      if (!commit.sha) return []
      const authoredAt = Date.parse(commit.commit?.author?.date ?? '')
      return [
        {
          sha: commit.sha,
          message: (commit.commit?.message ?? '').split('\n')[0].slice(0, 300),
          authoredAt: Number.isFinite(authoredAt) ? authoredAt : 0,
          parentShas: (commit.parents ?? []).flatMap((parent) => (parent.sha ? [parent.sha] : [])),
        },
      ]
    })
  }

  private async api<T>(route: `GET ${string}`, parameters: Record<string, unknown>): Promise<T> {
    try {
      const response = await this.request(route, {
        ...parameters,
        request: { signal: AbortSignal.timeout(20_000) },
      })
      return response.data as T
    } catch (error) {
      throw normalizeGitHubProjectError(error, this.repository, this.hasToken, this.t)
    }
  }
}
