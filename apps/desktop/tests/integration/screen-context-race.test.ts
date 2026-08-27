import type { NativeImage } from 'electron'
import { describe, it } from 'vitest'

import type { NormalizedScreenContextImage } from '../../src/main/screen-context/ImageNormalizer'
import type { ScreenCaptureAdapter } from '../../src/main/screen-context/ScreenCaptureAdapter'
import {
  ScreenContextError,
  ScreenContextService,
} from '../../src/main/screen-context/ScreenContextService'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

type CapturedScreenSource = Awaited<ReturnType<ScreenCaptureAdapter['captureSource']>>

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const captures = new Map<string, Deferred<CapturedScreenSource>>()
const adapter = {
  captureSource: (sourceId: string) => {
    const capture = deferred<CapturedScreenSource>()
    captures.set(sourceId, capture)
    return capture.promise
  },
} as ScreenCaptureAdapter
const normalizedImage: NormalizedScreenContextImage = {
  bytes: new Uint8Array([1]),
  mimeType: 'image/png',
  previewDataUrl: 'data:image/png;base64,AQ==',
  width: 1,
  height: 1,
}
const normalizer = {
  normalizeDesktopCapture: () => normalizedImage,
} as unknown as ConstructorParameters<typeof ScreenContextService>[1]
const service = new ScreenContextService(adapter, normalizer)

async function run(): Promise<void> {
  const rendererId = 1
  const captureA = service.capture(rendererId, crypto.randomUUID(), 'A')
  const operationB = crypto.randomUUID()
  const captureB = service.capture(rendererId, operationB, 'B')

  captures.get('B')?.resolve({
    image: {} as NativeImage,
    sourceName: 'B',
    sourceKind: 'window',
  })
  const descriptorB = await captureB

  captures.get('A')?.resolve({
    image: {} as NativeImage,
    sourceName: 'A',
    sourceKind: 'window',
  })
  try {
    await captureA
    throw new Error('Stale operation A unexpectedly replaced capture B')
  } catch (error) {
    if (!(error instanceof ScreenContextError) || error.code !== 'OPERATION_STALE') throw error
  }

  const retained = service.acquireForTurn(rendererId, descriptorB.captureId, 'turn-b')
  if (retained.sourceName !== 'B') throw new Error('Capture B was not retained')
  service.completeTurn(rendererId, descriptorB.captureId, 'turn-b')

  const operationC = crypto.randomUUID()
  const captureC = service.capture(rendererId, operationC, 'C')
  if (!service.cancelOperation(rendererId, operationC)) {
    throw new Error('Active operation C was not cancelled')
  }
  captures.get('C')?.resolve({
    image: {} as NativeImage,
    sourceName: 'C',
    sourceKind: 'window',
  })
  try {
    await captureC
    throw new Error('Cancelled operation C unexpectedly stored a capture')
  } catch (error) {
    if (!(error instanceof ScreenContextError) || error.code !== 'OPERATION_STALE') throw error
  }

  service.dispose()
  console.log('Screen context race repro passed')
}

describe('screen context races', () => {
  it('rejects stale and cancelled captures', async () => {
    await run()
  })
})
