import axios, { type AxiosInstance } from 'axios'

import { DEFAULT_UI_LOCALE, type Translator, translate } from '../../../shared/localization'
import type {
  ProjectRepositoryIdentity,
  ProjectSourceFile,
} from '../../../shared/project-awareness'
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
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  const status = error.response?.status
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
  private readonly http: AxiosInstance
  private readonly rawHttp: AxiosInstance
  private readonly treeBlobs = new Map<string, { sha: string; size: number }>()

  constructor(
    private readonly owner: string,
    private readonly name: string,
    token: string,
    private readonly t: Translator = (key, params) => translate(DEFAULT_UI_LOCALE, key, params),
  ) {
    const repository = `${owner}/${name}`
    const normalizeRejectedRequest = (error: unknown): Promise<never> =>
      Promise.reject(normalizeGitHubProjectError(error, repository, Boolean(token), this.t))
    this.http = axios.create({
      baseURL: 'https://api.github.com',
      timeout: 20_000,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Shio-Project-Awareness',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    this.http.interceptors.response.use((response) => response, normalizeRejectedRequest)
    this.rawHttp = axios.create({
      baseURL: `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      timeout: 20_000,
      responseType: 'text',
      transformResponse: [(data: unknown) => data],
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    this.rawHttp.interceptors.response.use((response) => response, normalizeRejectedRequest)
  }

  async getRepository(): Promise<ProjectRepositoryIdentity> {
    const response = await this.http.get<GitHubRepositoryResponse>(
      `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.name)}`,
    )
    if (!response.data.default_branch) {
      throw new Error(this.t('main.error.github.defaultBranchMissing'))
    }
    return {
      provider: 'github',
      owner: this.owner,
      name: this.name,
      defaultBranch: response.data.default_branch,
    }
  }

  async getBranchHead(branch: string): Promise<string> {
    const response = await this.http.get<GitHubCommitResponse>(
      `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.name)}/commits/${encodeURIComponent(branch)}`,
    )
    if (!response.data.sha) throw new Error(this.t('main.error.github.commitMissing'))
    return response.data.sha
  }

  async listTree(commitSha: string): Promise<ProjectTreeEntry[]> {
    const response = await this.http.get<GitHubTreeResponse>(
      `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.name)}/git/trees/${encodeURIComponent(commitSha)}`,
      { params: { recursive: '1' } },
    )
    if (response.data.truncated) {
      throw new Error(this.t('main.error.github.treeTruncated'))
    }
    const tree = (response.data.tree ?? []).flatMap((entry) => {
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
      const response = await this.rawHttp.get<string>(
        `${encodeURIComponent(commitSha)}/${encodePath(path)}`,
      )
      const content =
        typeof response.data === 'string' ? response.data : String(response.data ?? '')
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
    const response = await this.http.get<GitHubContentResponse>(
      `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.name)}/contents/${encodePath(path)}`,
      { params: { ref: commitSha } },
    )
    const data = response.data
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
    const response = await this.http.get<GitHubCompareResponse>(
      `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.name)}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`,
    )
    return (response.data.files ?? []).flatMap((file) => {
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
    const response = await this.http.get<GitHubCommitResponse[]>(
      `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.name)}/commits`,
      { params: { sha: branch, per_page: Math.max(1, Math.min(20, limit)) } },
    )
    return response.data.flatMap((commit) => {
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
}
