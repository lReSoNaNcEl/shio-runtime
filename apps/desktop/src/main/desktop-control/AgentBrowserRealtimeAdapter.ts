import type { BrowserSessionState } from '../../shared/desktop-control'
import {
  BROWSER_REALTIME_CAPTURE_TIMEOUT_MS,
  BROWSER_REALTIME_MAX_FRAME_BYTES,
  BROWSER_REALTIME_MAX_FRAME_EDGE,
  BROWSER_REALTIME_MAX_INPUT_BATCH_SIZE,
  type BrowserGameSurfaceCandidate,
  type BrowserRealtimeControlProvider,
  type BrowserRealtimeFrame,
  type BrowserRealtimeFrameCaptureRequest,
  type BrowserRealtimeInputBatch,
  type BrowserRealtimeInputEvent,
  type BrowserRealtimePointerButton,
  type BrowserRealtimeSession,
  type BrowserRealtimeViewport,
} from '../../shared/desktop-control'

const SOCKET_CONNECT_TIMEOUT_MS = 5_000
const MIN_FRAME_AGE_MS = 16
const MAX_FRAME_AGE_MS = 2_000
const DEFAULT_FRAME_AGE_MS = 1_000

export type BrowserRealtimeErrorCode =
  | 'NO_ACTIVE_SESSION'
  | 'SESSION_MISMATCH'
  | 'STREAM_UNAVAILABLE'
  | 'FRAME_TIMEOUT'
  | 'INVALID_FRAME'
  | 'INVALID_INPUT'
  | 'CANCELLED'

export class BrowserRealtimeError extends Error {
  constructor(readonly code: BrowserRealtimeErrorCode) {
    super(code)
    this.name = 'BrowserRealtimeError'
  }
}

interface StreamSocket {
  readonly readyState: number
  addEventListener(
    type: 'open' | 'close' | 'error' | 'message',
    listener: (event: { data: unknown }) => void,
  ): void
  removeEventListener(type: 'open' | 'close' | 'error', listener: () => void): void
  send(data: string): void
  close(): void
}

export interface AgentBrowserRealtimeAdapterOptions {
  session(): BrowserSessionState | null
  runStreamCommand(args: readonly string[], signal?: AbortSignal): Promise<string>
  inspectGameSurfaces(signal: AbortSignal): Promise<readonly BrowserGameSurfaceCandidate[]>
  createSocket?: (url: string) => StreamSocket
  now?: () => number
}

interface CaptureWaiter {
  binding: BrowserRealtimeSession
  maxFrameAgeMs: number
  resolve(frame: BrowserRealtimeFrame): void
  reject(error: BrowserRealtimeError): void
}

interface StreamFrameMessage {
  type: 'frame'
  seq: number
  data: string
  metadata: {
    deviceWidth: number
    deviceHeight: number
    pageScaleFactor: number
    timestamp: number
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output) as unknown
  } catch {
    throw new BrowserRealtimeError('STREAM_UNAVAILABLE')
  }
}

function findStreamPort(value: unknown): number | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStreamPort(item)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!isRecord(value)) return undefined
  if (Number.isInteger(value.port) && Number(value.port) >= 1 && Number(value.port) <= 65_535) {
    return Number(value.port)
  }
  for (const item of Object.values(value)) {
    const found = findStreamPort(item)
    if (found !== undefined) return found
  }
  return undefined
}

function sessionFromState(state: BrowserSessionState | null): BrowserRealtimeSession | null {
  if (state?.status !== 'ready' || !state.currentUrl || !state.activeTabId) return null
  try {
    const url = new URL(state.currentUrl)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return {
      sessionId: state.sessionId,
      tabId: state.activeTabId,
      origin: url.origin,
      url: url.href,
      connectedAt: state.openedAt,
    }
  } catch {
    return null
  }
}

function boundedNumber(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : undefined
}

function parseFrameMessage(value: unknown): StreamFrameMessage {
  if (!isRecord(value) || value.type !== 'frame' || !isRecord(value.metadata)) {
    throw new BrowserRealtimeError('INVALID_FRAME')
  }
  const seq = boundedNumber(value.seq, 0, Number.MAX_SAFE_INTEGER)
  const deviceWidth = boundedNumber(value.metadata.deviceWidth, 1, 32_768)
  const deviceHeight = boundedNumber(value.metadata.deviceHeight, 1, 32_768)
  const pageScaleFactor = boundedNumber(value.metadata.pageScaleFactor, 0.1, 10)
  const timestamp = boundedNumber(value.metadata.timestamp, 0, Number.MAX_SAFE_INTEGER)
  if (
    seq === undefined ||
    !Number.isInteger(seq) ||
    typeof value.data !== 'string' ||
    deviceWidth === undefined ||
    deviceHeight === undefined ||
    pageScaleFactor === undefined ||
    timestamp === undefined
  ) {
    throw new BrowserRealtimeError('INVALID_FRAME')
  }
  return {
    type: 'frame',
    seq,
    data: value.data,
    metadata: { deviceWidth, deviceHeight, pageScaleFactor, timestamp },
  }
}

function decodeImage(data: string): BrowserRealtimeFrame['image'] & {
  width: number
  height: number
} {
  if (
    data.length === 0 ||
    data.length > Math.ceil((BROWSER_REALTIME_MAX_FRAME_BYTES * 4) / 3) + 4
  ) {
    throw new BrowserRealtimeError('INVALID_FRAME')
  }
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length === 0 || bytes.length > BROWSER_REALTIME_MAX_FRAME_BYTES) {
    throw new BrowserRealtimeError('INVALID_FRAME')
  }
  const dimensions = readImageDimensions(bytes)
  if (
    !dimensions ||
    dimensions.width > BROWSER_REALTIME_MAX_FRAME_EDGE ||
    dimensions.height > BROWSER_REALTIME_MAX_FRAME_EDGE
  ) {
    throw new BrowserRealtimeError('INVALID_FRAME')
  }
  return { ...dimensions, bytes }
}

function readImageDimensions(
  bytes: Uint8Array,
): { mimeType: 'image/jpeg' | 'image/png'; width: number; height: number } | undefined {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { mimeType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === undefined) return undefined
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2
      continue
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)
    if (length < 2 || offset + length + 2 > bytes.length) return undefined
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    ) {
      const height = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0)
      const width = ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0)
      return width > 0 && height > 0 ? { mimeType: 'image/jpeg', width, height } : undefined
    }
    offset += length + 2
  }
  return undefined
}

function parseStreamUrl(value: unknown): string | undefined {
  if (!isRecord(value) || value.type !== 'url') return undefined
  const candidate = [value.url, value.value].find(
    (item): item is string => typeof item === 'string' && item.length <= 2_048,
  )
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}

function parseActiveTabId(value: unknown): string | undefined {
  if (!isRecord(value) || value.type !== 'tabs' || !Array.isArray(value.tabs)) return undefined
  const active = value.tabs.find(
    (tab) =>
      isRecord(tab) && (tab.active === true || tab.isActive === true || tab.selected === true),
  )
  if (!isRecord(active)) return undefined
  return [active.id, active.tabId, active.targetId].find(
    (item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 200,
  )
}

function validKeyValue(value: string | undefined, maximum: number): boolean {
  return (
    value === undefined ||
    (value.length > 0 &&
      value.length <= maximum &&
      ![...value].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint < 32 || codePoint === 127
      }))
  )
}

export class AgentBrowserRealtimeAdapter implements BrowserRealtimeControlProvider {
  private socket: StreamSocket | null = null
  private connectionPromise: Promise<void> | null = null
  private binding: BrowserRealtimeSession | null = null
  private viewport: BrowserRealtimeViewport | null = null
  private pendingFrame: BrowserRealtimeFrame | null = null
  private captureWaiter: CaptureWaiter | null = null
  private readonly pressedKeys = new Set<string>()
  private readonly pressedButtons = new Map<
    BrowserRealtimePointerButton,
    { x: number; y: number }
  >()

  constructor(private readonly options: AgentBrowserRealtimeAdapterOptions) {}

  session(): BrowserRealtimeSession | null {
    const current = sessionFromState(this.options.session())
    if (!current) return null
    if (
      this.binding &&
      this.binding.sessionId === current.sessionId &&
      this.binding.tabId === current.tabId &&
      this.binding.origin === current.origin
    ) {
      return { ...this.binding }
    }
    return current
  }

  inspectGameSurfaces(signal: AbortSignal): Promise<readonly BrowserGameSurfaceCandidate[]> {
    if (!this.session()) return Promise.reject(new BrowserRealtimeError('NO_ACTIVE_SESSION'))
    return this.options.inspectGameSurfaces(signal)
  }

  async captureFrame(
    request: BrowserRealtimeFrameCaptureRequest,
    signal: AbortSignal,
  ): Promise<BrowserRealtimeFrame> {
    await this.ensureConnected(signal)
    const binding = this.assertIdentity(request.sessionId, request.tabId)
    if (signal.aborted) throw new BrowserRealtimeError('CANCELLED')
    const maxFrameAgeMs = Math.min(
      MAX_FRAME_AGE_MS,
      Math.max(MIN_FRAME_AGE_MS, request.maxFrameAgeMs ?? DEFAULT_FRAME_AGE_MS),
    )
    if (this.captureWaiter) throw new BrowserRealtimeError('STREAM_UNAVAILABLE')
    if (this.pendingFrame) {
      const pending = this.pendingFrame
      this.pendingFrame = null
      if (this.now() - pending.capturedAt <= maxFrameAgeMs) {
        this.acknowledge(pending.frameId)
        return pending
      }
      this.acknowledge(pending.frameId)
    }
    return new Promise<BrowserRealtimeFrame>((resolve, reject) => {
      let waiter: CaptureWaiter
      const abort = (): void => settle(undefined, new BrowserRealtimeError('CANCELLED'))
      const timer = setTimeout(
        () => settle(undefined, new BrowserRealtimeError('FRAME_TIMEOUT')),
        BROWSER_REALTIME_CAPTURE_TIMEOUT_MS,
      )
      const settle = (frame?: BrowserRealtimeFrame, error?: BrowserRealtimeError): void => {
        if (this.captureWaiter !== waiter) return
        this.captureWaiter = null
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        if (frame) resolve(frame)
        else reject(error ?? new BrowserRealtimeError('STREAM_UNAVAILABLE'))
      }
      waiter = {
        binding,
        maxFrameAgeMs,
        resolve: (frame) => settle(frame),
        reject: (error) => settle(undefined, error),
      }
      this.captureWaiter = waiter
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }

  async dispatchInput(input: BrowserRealtimeInputBatch, signal: AbortSignal): Promise<void> {
    await this.ensureConnected(signal)
    this.assertIdentity(input.sessionId, input.tabId)
    if (
      input.events.length === 0 ||
      input.events.length > BROWSER_REALTIME_MAX_INPUT_BATCH_SIZE ||
      !this.viewport
    ) {
      throw new BrowserRealtimeError('INVALID_INPUT')
    }
    for (const event of input.events) this.validateInput(event, this.viewport)
    for (const event of input.events) {
      if (signal.aborted) throw new BrowserRealtimeError('CANCELLED')
      this.sendInput(event, this.viewport)
    }
  }

  async releaseInputs(): Promise<void> {
    const socket = this.socket
    try {
      if (socket?.readyState === 1) {
        for (const [button, point] of this.pressedButtons) {
          try {
            this.sendJson({
              type: 'input_mouse',
              eventType: 'mouseReleased',
              ...point,
              button,
              clickCount: 1,
            })
          } catch {
            break
          }
        }
        for (const key of this.pressedKeys) {
          try {
            this.sendJson({ type: 'input_keyboard', eventType: 'keyUp', key })
          } catch {
            break
          }
        }
      }
    } finally {
      this.pressedButtons.clear()
      this.pressedKeys.clear()
    }
  }

  async getViewport(): Promise<BrowserRealtimeViewport> {
    const session = this.session()
    if (!session) throw new BrowserRealtimeError('NO_ACTIVE_SESSION')
    if (this.viewport) return { ...this.viewport }
    const controller = new AbortController()
    const frame = await this.captureFrame(
      { sessionId: session.sessionId, tabId: session.tabId },
      controller.signal,
    )
    return { ...frame.viewport }
  }

  async close(): Promise<void> {
    await this.releaseInputs()
    this.captureWaiter?.reject(new BrowserRealtimeError('STREAM_UNAVAILABLE'))
    this.captureWaiter = null
    const socket = this.socket
    this.socket = null
    this.connectionPromise = null
    this.binding = null
    this.viewport = null
    this.pendingFrame = null
    if (socket && socket.readyState < 2) socket.close()
  }

  private async ensureConnected(signal: AbortSignal): Promise<void> {
    const current = sessionFromState(this.options.session())
    if (!current) throw new BrowserRealtimeError('NO_ACTIVE_SESSION')
    if (this.socket?.readyState === 1) {
      this.assertIdentity(current.sessionId, current.tabId)
      return
    }
    this.connectionPromise ??= this.connect(current, signal).finally(() => {
      this.connectionPromise = null
    })
    await this.connectionPromise
  }

  private async connect(session: BrowserRealtimeSession, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new BrowserRealtimeError('CANCELLED')
    let port = findStreamPort(
      parseJson(await this.options.runStreamCommand(['stream', 'status'], signal)),
    )
    if (!port) {
      const enabled = parseJson(await this.options.runStreamCommand(['stream', 'enable'], signal))
      port = findStreamPort(enabled)
      port ??= findStreamPort(
        parseJson(await this.options.runStreamCommand(['stream', 'status'], signal)),
      )
    }
    if (!port) throw new BrowserRealtimeError('STREAM_UNAVAILABLE')
    const socket = (this.options.createSocket ?? ((url) => new WebSocket(url)))(
      `ws://127.0.0.1:${port}/?pacing=ack&maxFps=10`,
    )
    this.socket = socket
    this.binding = { ...session, connectedAt: this.now() }
    socket.addEventListener('message', (event) => this.handleMessage(event.data))
    socket.addEventListener('close', () => this.handleClosed())
    await new Promise<void>((resolve, reject) => {
      const opened = (): void => settle()
      const failed = (): void => settle(new BrowserRealtimeError('STREAM_UNAVAILABLE'))
      const aborted = (): void => settle(new BrowserRealtimeError('CANCELLED'))
      const timer = setTimeout(failed, SOCKET_CONNECT_TIMEOUT_MS)
      const settle = (error?: BrowserRealtimeError): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', aborted)
        socket.removeEventListener('open', opened)
        socket.removeEventListener('error', failed)
        if (error) reject(error)
        else resolve()
      }
      socket.addEventListener('open', opened)
      socket.addEventListener('error', failed)
      signal.addEventListener('abort', aborted, { once: true })
      if (signal.aborted) aborted()
    }).catch((error) => {
      if (this.socket === socket) {
        this.socket = null
        this.binding = null
      }
      if (socket.readyState < 2) socket.close()
      throw error
    })
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return
    let message: unknown
    try {
      message = JSON.parse(data) as unknown
    } catch {
      return
    }
    if (isRecord(message) && message.type === 'frame') {
      try {
        this.acceptFrame(parseFrameMessage(message))
      } catch {
        this.invalidate('INVALID_FRAME')
      }
      return
    }
    const url = parseStreamUrl(message)
    if (url && this.binding) {
      if (new URL(url).origin !== this.binding.origin) {
        this.invalidate('SESSION_MISMATCH')
        return
      }
      this.binding = { ...this.binding, url }
    }
    const activeTabId = parseActiveTabId(message)
    if (activeTabId && this.binding && activeTabId !== this.binding.tabId) {
      this.invalidate('SESSION_MISMATCH')
    }
  }

  private acceptFrame(message: StreamFrameMessage): void {
    const binding = this.binding
    if (!binding) return
    const image = decodeImage(message.data)
    const now = this.now()
    const capturedAt = message.metadata.timestamp <= now + 60_000 ? message.metadata.timestamp : now
    const viewport = {
      width: message.metadata.deviceWidth,
      height: message.metadata.deviceHeight,
      pageScaleFactor: message.metadata.pageScaleFactor,
    }
    const frame: BrowserRealtimeFrame = {
      sessionId: binding.sessionId,
      tabId: binding.tabId,
      frameId: message.seq,
      capturedAt,
      width: image.width,
      height: image.height,
      viewport,
      image: { mimeType: image.mimeType, bytes: image.bytes },
    }
    this.viewport = viewport
    const waiter = this.captureWaiter
    if (
      waiter &&
      waiter.binding.sessionId === binding.sessionId &&
      waiter.binding.tabId === binding.tabId &&
      now - capturedAt <= waiter.maxFrameAgeMs
    ) {
      this.acknowledge(frame.frameId)
      waiter.resolve(frame)
      return
    }
    if (waiter && now - capturedAt > waiter.maxFrameAgeMs) {
      this.acknowledge(frame.frameId)
      return
    }
    if (this.pendingFrame) this.acknowledge(this.pendingFrame.frameId)
    this.pendingFrame = frame
  }

  private sendInput(event: BrowserRealtimeInputEvent, viewport: BrowserRealtimeViewport): void {
    if (
      event.type === 'pointer-move' ||
      event.type === 'pointer-down' ||
      event.type === 'pointer-up'
    ) {
      if (
        !Number.isFinite(event.x) ||
        !Number.isFinite(event.y) ||
        event.x < 0 ||
        event.y < 0 ||
        event.x > viewport.width ||
        event.y > viewport.height
      ) {
        throw new BrowserRealtimeError('INVALID_INPUT')
      }
      const eventType =
        event.type === 'pointer-move'
          ? 'mouseMoved'
          : event.type === 'pointer-down'
            ? 'mousePressed'
            : 'mouseReleased'
      const button = event.type === 'pointer-move' ? 'none' : event.button
      this.sendJson({
        type: 'input_mouse',
        eventType,
        x: event.x,
        y: event.y,
        button,
        clickCount: event.type === 'pointer-move' ? 0 : 1,
      })
      if (event.type === 'pointer-down') {
        this.pressedButtons.set(event.button, { x: event.x, y: event.y })
      } else if (event.type === 'pointer-up') {
        this.pressedButtons.delete(event.button)
      } else {
        for (const button of this.pressedButtons.keys()) {
          this.pressedButtons.set(button, { x: event.x, y: event.y })
        }
      }
      return
    }
    if (event.type !== 'key-down' && event.type !== 'key-up') {
      throw new BrowserRealtimeError('INVALID_INPUT')
    }
    if (
      !validKeyValue(event.key, 64) ||
      !validKeyValue(event.code, 64) ||
      !validKeyValue(event.text, 16)
    ) {
      throw new BrowserRealtimeError('INVALID_INPUT')
    }
    const eventType = event.type === 'key-down' ? 'keyDown' : 'keyUp'
    this.sendJson({
      type: 'input_keyboard',
      eventType,
      key: event.key,
      ...(event.code ? { code: event.code } : {}),
      ...(event.type === 'key-down' && event.text ? { text: event.text } : {}),
    })
    if (event.type === 'key-down') this.pressedKeys.add(event.key)
    else this.pressedKeys.delete(event.key)
  }

  private validateInput(event: BrowserRealtimeInputEvent, viewport: BrowserRealtimeViewport): void {
    if (
      event.type === 'pointer-move' ||
      event.type === 'pointer-down' ||
      event.type === 'pointer-up'
    ) {
      if (
        !Number.isFinite(event.x) ||
        !Number.isFinite(event.y) ||
        event.x < 0 ||
        event.y < 0 ||
        event.x > viewport.width ||
        event.y > viewport.height
      ) {
        throw new BrowserRealtimeError('INVALID_INPUT')
      }
      return
    }
    if (
      (event.type !== 'key-down' && event.type !== 'key-up') ||
      !validKeyValue(event.key, 64) ||
      !validKeyValue(event.code, 64) ||
      !validKeyValue(event.text, 16)
    ) {
      throw new BrowserRealtimeError('INVALID_INPUT')
    }
  }

  private assertIdentity(sessionId: string, tabId: string): BrowserRealtimeSession {
    const current = sessionFromState(this.options.session())
    const binding = this.binding
    if (!current || !binding) throw new BrowserRealtimeError('NO_ACTIVE_SESSION')
    if (
      sessionId !== binding.sessionId ||
      tabId !== binding.tabId ||
      current.sessionId !== binding.sessionId ||
      current.tabId !== binding.tabId ||
      current.origin !== binding.origin
    ) {
      this.invalidate('SESSION_MISMATCH')
      throw new BrowserRealtimeError('SESSION_MISMATCH')
    }
    return binding
  }

  private acknowledge(frameId: number): void {
    if (this.socket?.readyState === 1) this.sendJson({ type: 'ack', seq: frameId })
  }

  private sendJson(value: Record<string, unknown>): void {
    if (this.socket?.readyState !== 1) throw new BrowserRealtimeError('STREAM_UNAVAILABLE')
    this.socket.send(JSON.stringify(value))
  }

  private invalidate(code: BrowserRealtimeErrorCode): void {
    this.captureWaiter?.reject(new BrowserRealtimeError(code))
    void this.close().catch(() => undefined)
  }

  private handleClosed(): void {
    this.captureWaiter?.reject(new BrowserRealtimeError('STREAM_UNAVAILABLE'))
    this.captureWaiter = null
    this.socket = null
    this.connectionPromise = null
    this.binding = null
    this.viewport = null
    this.pendingFrame = null
    this.pressedButtons.clear()
    this.pressedKeys.clear()
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}
