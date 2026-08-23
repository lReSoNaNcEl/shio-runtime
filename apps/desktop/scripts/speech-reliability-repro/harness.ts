import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { SpeechClientManager } from '../../src/main/speech/SpeechClientManager'
import { SpeechServiceError } from '../../src/main/speech/speechErrors'

interface SpeechServer {
  url: string
  requests: Record<'health' | 'recognize' | 'synthesize', number>
  waitForSynthesisStarted(count: number): Promise<void>
  waitForSynthesisClosed(count: number): Promise<void>
  close(): Promise<void>
}

function waitUntil(predicate: () => boolean): Promise<void> {
  if (predicate()) return Promise.resolve()
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (!predicate()) return
      clearInterval(interval)
      resolve()
    }, 5)
  })
}

function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

async function startSpeechServer(delaySynthesis: boolean): Promise<SpeechServer> {
  const requests = { health: 0, recognize: 0, synthesize: 0 }
  let closedSyntheses = 0
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      requests.health += 1
      json(response, { status: 'ok', engines: { f5: { status: 'ok', mode: 'real' } } })
      return
    }
    if (request.url === '/recognize') {
      requests.recognize += 1
      json(response, { text: 'recognized by current endpoint' })
      return
    }
    if (request.url === '/synthesize') {
      requests.synthesize += 1
      let completed = false
      response.once('close', () => {
        if (!completed) closedSyntheses += 1
      })
      if (delaySynthesis) return
      completed = true
      response.writeHead(200, { 'content-type': 'audio/wav' })
      response.end(Buffer.alloc(44))
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    waitForSynthesisStarted: (count) => waitUntil(() => requests.synthesize >= count),
    waitForSynthesisClosed: (count) => waitUntil(() => closedSyntheses >= count),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}

async function expectCancelled(operation: Promise<unknown>): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof SpeechServiceError)
    assert.equal(error.code, 'CANCELLED')
    return true
  })
}

async function main(): Promise<void> {
  const oldServer = await startSpeechServer(true)
  const newServer = await startSpeechServer(false)
  const manager = new SpeechClientManager(oldServer.url)

  try {
    const turnAbort = new AbortController()
    const cancelledByTurn = manager.synthesize(
      { text: 'long turn cancellation request' },
      turnAbort.signal,
    )
    await oldServer.waitForSynthesisStarted(1)
    turnAbort.abort()
    await Promise.all([expectCancelled(cancelledByTurn), oldServer.waitForSynthesisClosed(1)])

    const cancelledByReconfigure = manager.synthesize({
      text: 'long endpoint replacement request',
    })
    await oldServer.waitForSynthesisStarted(2)
    assert.equal(manager.reconfigure(`${newServer.url}/`), true)
    await Promise.all([
      expectCancelled(cancelledByReconfigure),
      oldServer.waitForSynthesisClosed(2),
    ])
    assert.equal(manager.reconfigure(newServer.url), false)

    const health = await manager.health()
    assert.equal(health.status, 'ok')
    const recognized = await manager.transcribe(new ArrayBuffer(44))
    assert.equal(recognized.text, 'recognized by current endpoint')
    const synthesized = await manager.synthesize({ text: 'new endpoint request' })
    assert.equal(synthesized.audioBuffer.byteLength, 44)

    assert.deepEqual(oldServer.requests, { health: 0, recognize: 0, synthesize: 2 })
    assert.deepEqual(newServer.requests, { health: 1, recognize: 1, synthesize: 1 })
    console.log('speech reliability repro: passed')
  } finally {
    manager.dispose()
    await Promise.all([oldServer.close(), newServer.close()])
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
