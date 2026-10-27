import { describe, expect, it } from 'vitest'

import { GitHubProjectAdapter } from '../../../src/main/project-awareness/adapters/GitHubProjectAdapter'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('@octokit/request GitHub Project Adapter', () => {
  it('preserves read-only routes, raw fallback, authentication, and response mapping', async () => {
    const calls: Array<{ url: URL; headers: Headers }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      calls.push({ url, headers: request.headers })
      if (url.hostname === 'raw.githubusercontent.com') {
        if (url.pathname.endsWith('/src/main.ts')) return new Response('export const ready = true')
        return new Response('missing', { status: 404 })
      }
      if (url.pathname === '/repos/owner/repo') return jsonResponse({ default_branch: 'main' })
      if (url.pathname.includes('/commits/feature%2Fone')) return jsonResponse({ sha: 'head-sha' })
      if (url.pathname.endsWith('/git/trees/head-sha')) {
        return jsonResponse({
          truncated: false,
          tree: [{ path: 'src/main.ts', type: 'blob', sha: 'blob-sha', size: 25 }],
        })
      }
      if (decodeURIComponent(url.pathname).endsWith('/contents/src/fallback.ts')) {
        return jsonResponse({
          type: 'file',
          sha: 'fallback-sha',
          size: 22,
          encoding: 'base64',
          content: Buffer.from('export const fallback=1').toString('base64'),
        })
      }
      if (url.pathname.includes('/compare/base-sha...head-sha')) {
        return jsonResponse({
          files: [{ filename: 'src/main.ts', previous_filename: 'src/old.ts', status: 'renamed' }],
        })
      }
      if (url.pathname.endsWith('/commits')) {
        return jsonResponse([
          {
            sha: 'commit-sha',
            commit: { message: 'First line\nbody', author: { date: '2026-08-27T10:00:00Z' } },
            parents: [{ sha: 'parent-sha' }],
          },
        ])
      }
      return jsonResponse({ error: 'unexpected route' }, 500)
    }

    const adapter = new GitHubProjectAdapter(
      'owner',
      'repo',
      'github-test-token',
      undefined,
      fetchImpl,
    )
    await expect(adapter.getRepository()).resolves.toMatchObject({ defaultBranch: 'main' })
    await expect(adapter.getBranchHead('feature/one')).resolves.toBe('head-sha')
    await expect(adapter.listTree('head-sha')).resolves.toHaveLength(1)
    await expect(adapter.readFile('src/main.ts', 'head-sha')).resolves.toMatchObject({
      sha: 'blob-sha',
      content: 'export const ready = true',
    })
    await expect(adapter.readFile('src/fallback.ts', 'head-sha')).resolves.toMatchObject({
      sha: 'fallback-sha',
      content: 'export const fallback=1',
    })
    await expect(adapter.compareCommits('base-sha', 'head-sha')).resolves.toEqual([
      { path: 'src/main.ts', previousPath: 'src/old.ts', status: 'renamed' },
    ])
    await expect(adapter.listRecentCommits('main', 100)).resolves.toEqual([
      {
        sha: 'commit-sha',
        message: 'First line',
        authoredAt: Date.parse('2026-08-27T10:00:00Z'),
        parentShas: ['parent-sha'],
      },
    ])

    expect(
      calls.every((call) => call.headers.get('authorization') === 'Bearer github-test-token'),
    ).toBe(true)
    expect(
      calls
        .find((call) => call.url.pathname.endsWith('/commits'))
        ?.url.searchParams.get('per_page'),
    ).toBe('20')
    expect(
      calls
        .find((call) => call.url.pathname.includes('/git/trees/'))
        ?.url.searchParams.get('recursive'),
    ).toBe('1')
  })

  it.each([
    [401, 'main.error.github.unauthorized'],
    [403, 'main.error.github.forbiddenToken'],
    [404, 'main.error.github.privateToken'],
  ] as const)('normalizes GitHub HTTP %i', async (status, expectedMessage) => {
    const adapter = new GitHubProjectAdapter(
      'owner',
      'repo',
      'token',
      (key) => key,
      async () => jsonResponse({ message: 'private provider detail' }, status),
    )
    await expect(adapter.getRepository()).rejects.toThrow(expectedMessage)
  })

  it('preserves truncated-tree and network failure semantics', async () => {
    const truncated = new GitHubProjectAdapter(
      'owner',
      'repo',
      '',
      (key) => key,
      async () => jsonResponse({ truncated: true, tree: [] }),
    )
    await expect(truncated.listTree('head-sha')).rejects.toThrow('main.error.github.treeTruncated')

    const offline = new GitHubProjectAdapter(
      'owner',
      'repo',
      '',
      (key) => key,
      async () => {
        throw new TypeError('private socket detail')
      },
    )
    await expect(offline.getRepository()).rejects.toThrow('main.error.github.network')
  })
})
