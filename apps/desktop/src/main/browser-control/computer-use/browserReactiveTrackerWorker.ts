import { parentPort } from 'node:worker_threads'

import sharp from 'sharp'

import type {
  ReactiveTrackedAnchor,
  ReactiveTrackerRequest,
  ReactiveTrackerResponse,
} from './BrowserReactiveTrackerProtocol'

interface TemplateState {
  planId: string
  frameWidth: number
  frameHeight: number
  previousFrame: Uint8Array
  anchors: Map<
    string,
    {
      template: Uint8Array
      templateWidth: number
      templateHeight: number
      bounds: ReactiveTrackedAnchor['bounds']
    }
  >
}

let state: TemplateState | null = null

const workerPort = parentPort
if (!workerPort) throw new Error('Reactive tracker worker requires a parent port')

workerPort.on('message', (request: ReactiveTrackerRequest) => {
  void track(request)
    .then((result) => {
      const response: ReactiveTrackerResponse = { type: 'tracked', result }
      workerPort.postMessage(response)
    })
    .catch((error: unknown) => {
      const response: ReactiveTrackerResponse = {
        type: 'failed',
        requestId: request.requestId,
        code: error instanceof Error ? error.name : 'TRACKER_FAILED',
      }
      workerPort.postMessage(response)
    })
})

async function track(request: ReactiveTrackerRequest) {
  const startedAt = performance.now()
  const decoded = await sharp(request.frame.bytes)
    .resize({ width: 640, height: 360, fit: 'inside', withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const pixels = new Uint8Array(decoded.data)
  const width = decoded.info.width
  const height = decoded.info.height
  maskSensitiveRegions(pixels, width, height, request.viewport, request.frame.sensitiveRegions)

  const reset =
    !state ||
    state.planId !== request.plan.id ||
    state.frameWidth !== width ||
    state.frameHeight !== height
  if (reset) state = createTemplateState(request, pixels, width, height)

  const current = state as TemplateState
  const anchors = reset
    ? [...current.anchors.entries()].map(
        ([id, anchor]): ReactiveTrackedAnchor => ({
          id,
          bounds: anchor.bounds,
          confidence: request.plan.confidence,
        }),
      )
    : trackAnchors(current, pixels, width, height, request.viewport)
  const sceneDifference = normalizedDifference(current.previousFrame, pixels)
  const motionIntensity = normalizedMotion(current.previousFrame, pixels)
  current.previousFrame = pixels
  const trackingConfidence =
    anchors.length > 0
      ? anchors.reduce((sum, anchor) => sum + anchor.confidence, 0) / anchors.length
      : 0
  return {
    requestId: request.requestId,
    planId: request.plan.id,
    pageId: request.frame.pageId,
    frameId: request.frame.id,
    receivedAt: request.frame.receivedAt,
    width,
    height,
    trackingConfidence,
    sceneDifference,
    motionIntensity,
    anchors,
    latencyMs: performance.now() - startedAt,
    workerMemoryBytes: process.memoryUsage().heapUsed,
  }
}

function createTemplateState(
  request: ReactiveTrackerRequest,
  pixels: Uint8Array,
  width: number,
  height: number,
): TemplateState {
  const scaleX = width / request.viewport.width
  const scaleY = height / request.viewport.height
  const anchors = new Map<
    string,
    TemplateState['anchors'] extends Map<string, infer A> ? A : never
  >()
  for (const anchor of request.plan.anchors) {
    const scaled = scaledBounds(anchor.bounds, scaleX, scaleY, width, height)
    const templateWidth = Math.max(4, Math.min(48, Math.round(scaled.width)))
    const templateHeight = Math.max(4, Math.min(48, Math.round(scaled.height)))
    const x = clamp(Math.round(scaled.x + scaled.width / 2 - templateWidth / 2), 0, width - 1)
    const y = clamp(Math.round(scaled.y + scaled.height / 2 - templateHeight / 2), 0, height - 1)
    const safeWidth = Math.max(1, Math.min(templateWidth, width - x))
    const safeHeight = Math.max(1, Math.min(templateHeight, height - y))
    anchors.set(anchor.id, {
      template: extractPatch(pixels, width, x, y, safeWidth, safeHeight),
      templateWidth: safeWidth,
      templateHeight: safeHeight,
      bounds: { ...anchor.bounds },
    })
  }
  return {
    planId: request.plan.id,
    frameWidth: width,
    frameHeight: height,
    previousFrame: pixels,
    anchors,
  }
}

function trackAnchors(
  current: TemplateState,
  pixels: Uint8Array,
  width: number,
  height: number,
  viewport: { width: number; height: number },
): ReactiveTrackedAnchor[] {
  const scaleX = width / viewport.width
  const scaleY = height / viewport.height
  const tracked: ReactiveTrackedAnchor[] = []
  for (const [id, anchor] of current.anchors) {
    const scaled = scaledBounds(anchor.bounds, scaleX, scaleY, width, height)
    const originX = Math.round(scaled.x + scaled.width / 2 - anchor.templateWidth / 2)
    const originY = Math.round(scaled.y + scaled.height / 2 - anchor.templateHeight / 2)
    const radius = 24
    let bestX = originX
    let bestY = originY
    let bestError = Number.POSITIVE_INFINITY
    for (let y = originY - radius; y <= originY + radius; y += 2) {
      if (y < 0 || y + anchor.templateHeight > height) continue
      for (let x = originX - radius; x <= originX + radius; x += 2) {
        if (x < 0 || x + anchor.templateWidth > width) continue
        const error = patchError(
          pixels,
          width,
          x,
          y,
          anchor.template,
          anchor.templateWidth,
          anchor.templateHeight,
        )
        if (error >= bestError) continue
        bestError = error
        bestX = x
        bestY = y
      }
    }
    const confidence = Number.isFinite(bestError) ? clamp(1 - bestError / 255, 0, 1) : 0
    const nextBounds = {
      x: bestX / scaleX,
      y: bestY / scaleY,
      width: anchor.bounds.width,
      height: anchor.bounds.height,
    }
    anchor.bounds = nextBounds
    tracked.push({ id, bounds: nextBounds, confidence })
  }
  return tracked
}

function scaledBounds(
  bounds: { x: number; y: number; width: number; height: number },
  scaleX: number,
  scaleY: number,
  width: number,
  height: number,
) {
  return {
    x: clamp(bounds.x * scaleX, 0, width - 1),
    y: clamp(bounds.y * scaleY, 0, height - 1),
    width: clamp(bounds.width * scaleX, 1, width),
    height: clamp(bounds.height * scaleY, 1, height),
  }
}

function extractPatch(
  pixels: Uint8Array,
  frameWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Uint8Array {
  const patch = new Uint8Array(width * height)
  for (let row = 0; row < height; row += 1) {
    patch.set(
      pixels.subarray((y + row) * frameWidth + x, (y + row) * frameWidth + x + width),
      row * width,
    )
  }
  return patch
}

function patchError(
  pixels: Uint8Array,
  frameWidth: number,
  x: number,
  y: number,
  template: Uint8Array,
  templateWidth: number,
  templateHeight: number,
): number {
  let difference = 0
  let samples = 0
  for (let row = 0; row < templateHeight; row += 2) {
    for (let column = 0; column < templateWidth; column += 2) {
      difference += Math.abs(
        pixels[(y + row) * frameWidth + x + column] - template[row * templateWidth + column],
      )
      samples += 1
    }
  }
  return samples > 0 ? difference / samples : 255
}

function normalizedDifference(previous: Uint8Array, current: Uint8Array): number {
  if (previous.length !== current.length || previous.length === 0) return 1
  let difference = 0
  let samples = 0
  for (let index = 0; index < current.length; index += 16) {
    difference += Math.abs(current[index] - previous[index])
    samples += 1
  }
  return samples > 0 ? difference / samples / 255 : 0
}

function normalizedMotion(previous: Uint8Array, current: Uint8Array): number {
  if (previous.length !== current.length || previous.length === 0) return 1
  let changed = 0
  let samples = 0
  for (let index = 0; index < current.length; index += 16) {
    if (Math.abs(current[index] - previous[index]) >= 20) changed += 1
    samples += 1
  }
  return samples > 0 ? changed / samples : 0
}

function maskSensitiveRegions(
  pixels: Uint8Array,
  width: number,
  height: number,
  viewport: { width: number; height: number },
  regions: ReactiveTrackerRequest['frame']['sensitiveRegions'],
): void {
  const scaleX = width / viewport.width
  const scaleY = height / viewport.height
  for (const region of regions) {
    const left = clamp(Math.floor(region.x * scaleX), 0, width)
    const top = clamp(Math.floor(region.y * scaleY), 0, height)
    const right = clamp(Math.ceil((region.x + region.width) * scaleX), 0, width)
    const bottom = clamp(Math.ceil((region.y + region.height) * scaleY), 0, height)
    for (let y = top; y < bottom; y += 1) pixels.fill(0, y * width + left, y * width + right)
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
