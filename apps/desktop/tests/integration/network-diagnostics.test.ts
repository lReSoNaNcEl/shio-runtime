import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { describe, it } from 'vitest'

import { createObservedFetch } from '../../src/main/diagnostics/createObservedFetch'
import { NetworkRequestDiagnostics } from '../../src/main/diagnostics/NetworkRequestDiagnostics'
import {
  observeAxiosNetwork,
  previewNetworkBody,
  safeNetworkHeaders,
  safeNetworkTarget,
} from '../../src/main/diagnostics/observeAxiosNetwork'
import { rendererUploadBody } from '../../src/main/diagnostics/RendererNetworkObserver'
import { IPC_CHANNEL_CAPABILITIES, IpcAuthorization } from '../../src/main/ipc/IpcAuthorization'

const desktopRoot = process.cwd().endsWith('apps\\desktop')
  ? process.cwd()
  : join(process.cwd(), 'apps', 'desktop')

function source(relativePath: string): string {
  return readFileSync(join(desktopRoot, relativePath), 'utf8')
}

function assertSafeMetadataBoundary(): void {
  assert.equal(
    safeNetworkTarget(
      '/v1/chat/completions?api_key=secret#private',
      'https://user:password@provider.example',
    ),
    'https://provider.example/v1/chat/completions',
  )
  assert.equal(safeNetworkTarget('file:///C:/Users/secret.txt'), null)

  const diagnostics = new NetworkRequestDiagnostics(2)
  diagnostics.start({ source: 'llm', method: 'post', target: 'https://one.example/path' })
  diagnostics.start({ source: 'speech-api', method: 'get', target: 'http://127.0.0.1/health' })
  diagnostics.start({ source: 'renderer-fetch', method: 'get', target: 'https://three.example/' })
  assert.equal(diagnostics.snapshot().length, 2, 'network diagnostics capacity is not bounded')
  assert.doesNotMatch(JSON.stringify(diagnostics.snapshot()), /secret|password|api_key/i)

  assert.deepEqual(safeNetworkHeaders({ Authorization: 'Bearer super-secret' }), [
    { name: 'Authorization', value: '[REDACTED]' },
  ])
  const largeBody = previewNetworkBody({ prompt: 'x'.repeat(10_000), apiKey: 'body-secret' })
  assert.equal(largeBody.kind, 'json')
  assert.equal(largeBody.truncated, true)
  assert.ok((largeBody.text?.length ?? 0) <= 8_000)
  assert.doesNotMatch(JSON.stringify(largeBody), /body-secret/)

  assert.deepEqual(rendererUploadBody(undefined), { kind: 'empty' })
  assert.deepEqual(rendererUploadBody([]), { kind: 'empty' })
  assert.deepEqual(rendererUploadBody([{ bytes: Buffer.from('test') }]), {
    kind: 'binary',
    byteLength: 4,
  })
  assert.deepEqual(rendererUploadBody([{ file: 'renderer-controlled-path' }]), {
    kind: 'binary',
    byteLength: undefined,
  })
}

async function assertAxiosLifecycle(): Promise<void> {
  const diagnostics = new NetworkRequestDiagnostics()
  const client = axios.create({ baseURL: 'https://provider.example' })
  const dispose = observeAxiosNetwork(client, 'llm', diagnostics)

  await client.post(
    '/models?token=query-secret',
    {
      prompt: 'safe prompt',
      apiKey: 'request-body-secret',
      nested: { password: 'nested-secret' },
    },
    {
      headers: {
        Authorization: 'Bearer request-header-secret',
        'X-Api-Key': 'request-api-key-secret',
      },
      adapter: async (config) => ({
        config,
        data: { model: 'test-model', token: 'response-body-secret' },
        headers: {
          'content-type': 'application/json',
          'set-cookie': ['session=response-cookie-secret'],
        },
        status: 200,
        statusText: 'OK',
      }),
    },
  )
  await assert.rejects(
    client.get('/slow', {
      adapter: async (config) => {
        throw new AxiosError(
          'timeout includes private transport details',
          'ECONNABORTED',
          config as InternalAxiosRequestConfig,
        )
      },
    }),
  )

  const requests = diagnostics.snapshot()
  assert.equal(requests.length, 2)
  assert.equal(requests[0].outcome, 'timeout')
  assert.equal(requests[1].outcome, 'success')
  assert.equal(requests[1].status, 200)
  assert.equal(requests[1].target, 'https://provider.example/models')
  assert.doesNotMatch(JSON.stringify(requests), /secret|prompt|private transport details/i)

  const details = diagnostics.details(requests[1].id)
  assert.ok(details)
  assert.equal(
    details.requestHeaders.find((header) => header.name.toLowerCase() === 'authorization')?.value,
    '[REDACTED]',
  )
  assert.equal(
    details.responseHeaders.find((header) => header.name.toLowerCase() === 'set-cookie')?.value,
    '[REDACTED]',
  )
  assert.match(details.requestBody.text ?? '', /safe prompt/)
  assert.match(details.requestBody.text ?? '', /\[REDACTED\]/)
  assert.match(details.responseBody.text ?? '', /test-model/)
  assert.doesNotMatch(
    JSON.stringify(details),
    /request-body-secret|nested-secret|request-header-secret|request-api-key-secret|response-body-secret|response-cookie-secret|query-secret/,
  )

  dispose()
  dispose()
  await client.get('/after-dispose', {
    adapter: async (config) => ({
      config,
      data: {},
      headers: {},
      status: 204,
      statusText: 'No Content',
    }),
  })
  assert.equal(diagnostics.snapshot().length, 2, 'disposed Axios observer still recorded traffic')
}

async function assertFetchLifecycle(): Promise<void> {
  const diagnostics = new NetworkRequestDiagnostics()
  const observed = createObservedFetch(
    async () =>
      new Response('data: {"visible":true}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    'llm',
    diagnostics,
  )
  const response = await observed('https://provider.example/v1/chat/completions?token=secret', {
    method: 'POST',
    headers: { Authorization: 'Bearer request-secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'safe', apiKey: 'body-secret' }),
  })

  assert.equal(response.bodyUsed, false, 'observed Fetch consumed the one-shot SSE body')
  assert.match(await response.text(), /visible/)
  const [request] = diagnostics.snapshot()
  assert.equal(request.outcome, 'success')
  assert.equal(request.target, 'https://provider.example/v1/chat/completions')
  const details = diagnostics.details(request.id)
  assert.ok(details)
  assert.equal(details.responseBody.kind, 'unavailable')
  assert.equal(details.responseBody.contentType, 'text/event-stream')
  assert.doesNotMatch(JSON.stringify(details), /request-secret|body-secret|token=secret/u)
}

function assertIpcAndUiBoundary(): void {
  assert.deepEqual(IPC_CHANNEL_CAPABILITIES['diagnostics:get-network-requests'], ['main'])
  assert.deepEqual(IPC_CHANNEL_CAPABILITIES['diagnostics:get-network-request-details'], ['main'])
  const authorization = new IpcAuthorization({ main: () => 1, overlay: () => 2 })
  assert.throws(
    () => authorization.assert({ sender: { id: 2 } } as never, 'diagnostics:get-network-requests'),
    /not authorized/,
  )
  assert.throws(
    () =>
      authorization.assert(
        { sender: { id: 2 } } as never,
        'diagnostics:get-network-request-details',
      ),
    /not authorized/,
  )

  const preload = source('src/preload/index.ts')
  const overlayPreload = source('src/preload/overlay.ts')
  assert.match(preload, /diagnostics:get-network-requests/)
  assert.match(preload, /diagnostics:get-network-request-details/)
  assert.doesNotMatch(overlayPreload, /diagnostics:get-network-requests/)
  assert.doesNotMatch(overlayPreload, /diagnostics:get-network-request-details/)

  const diagnosticsView = source('src/renderer/components/views/DiagnosticsView.tsx')
  const networkDiagnostics = source('src/renderer/components/diagnostics/NetworkDiagnostics.tsx')
  const diagnosticsCss = source('src/renderer/styles/diagnostics.css')
  assert.match(diagnosticsView, /<Tab id="network">/)
  assert.match(diagnosticsView, /getNetworkRequestDetails/)
  assert.match(diagnosticsView, /<NetworkDiagnostics/)
  assert.match(networkDiagnostics, /safeMetadata/)
  assert.match(networkDiagnostics, /aria-expanded=\{expandedRequestId === request\.id\}/)
  assert.doesNotMatch(diagnosticsCss, /\.diagnostics-tabs\s+button/)
  assert.doesNotMatch(diagnosticsCss, /\.diagnostics-toolbar\s*\{[^}]*top:\s*-/s)
}

async function main(): Promise<void> {
  assertSafeMetadataBoundary()
  await assertAxiosLifecycle()
  await assertFetchLifecycle()
  assertIpcAndUiBoundary()
  console.log('Network Diagnostics focused repro: PASS')
}

describe('network diagnostics', () => {
  it('records safe bounded request metadata', async () => {
    await main()
  })
})
