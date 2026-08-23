import type { TranslationKey } from '../../shared/localization'
import { DEFAULT_UI_LOCALE, translate, type UiLocale } from '../../shared/localization'
import type { RuntimeEventType } from '../../shared/runtime'
import type {
  SerializedSpeechError,
  SpeechOperation,
  SpeechServiceErrorCode,
} from '../../shared/speech'
import { isRecoverableSpeechErrorCode } from '../../shared/speech'

/**
 * Renderer-side Speech Adapter error. Built from the serialized IPC contract and
 * augmented with a user-facing message. This is the stable object the renderer
 * runtimes throw/report; it never carries stack traces or transport details into
 * the UI beyond the sanitized `technicalMessage`.
 */
export class SpeechServiceError extends Error implements SerializedSpeechError {
  readonly code: SpeechServiceErrorCode
  readonly operation: SpeechOperation
  readonly recoverable: boolean
  readonly technicalMessage?: string

  constructor(fields: SerializedSpeechError) {
    super(fields.technicalMessage ?? fields.code)
    this.name = 'SpeechServiceError'
    this.code = fields.code
    this.operation = fields.operation
    this.recoverable = fields.recoverable
    this.technicalMessage = fields.technicalMessage
  }

  get userMessage(): string {
    return this.userMessageFor(DEFAULT_UI_LOCALE)
  }

  userMessageFor(locale: UiLocale): string {
    return translate(locale, USER_MESSAGE_KEYS[this.code].title)
  }

  toSerialized(): SerializedSpeechError {
    return {
      code: this.code,
      operation: this.operation,
      recoverable: this.recoverable,
      technicalMessage: this.technicalMessage,
    }
  }
}

/** Build a renderer error from an IPC response that failed with an error code. */
export function speechErrorFromResponse(
  operation: SpeechOperation,
  response: { error?: string; errorCode?: SpeechServiceErrorCode },
): SpeechServiceError {
  const code = response.errorCode ?? 'UNKNOWN'
  return new SpeechServiceError({
    code,
    operation,
    recoverable: isRecoverableSpeechErrorCode(code),
    technicalMessage: response.error,
  })
}

export function isSpeechServiceError(error: unknown): error is SpeechServiceError {
  return error instanceof SpeechServiceError
}

// ---- capability state ------------------------------------------------------

export type SpeechServiceStatus = 'unknown' | 'checking' | 'available' | 'degraded' | 'unavailable'
export type SpeechCapabilityStatus = 'unknown' | 'available' | 'unavailable'

export interface SpeechCapabilitiesState {
  service: SpeechServiceStatus
  recognition: SpeechCapabilityStatus
  synthesis: SpeechCapabilityStatus
  streaming: SpeechCapabilityStatus
  lastCheckedAt?: number
  lastErrorCode?: SpeechServiceErrorCode
  /** Sanitized technical hint for the Runtime Health "Технические детали" block. */
  technicalMessage?: string
  /**
   * Monotonic incident counter. Increments each time capabilities transition
   * from healthy into a problem state. The UI dedups the banner per incident so
   * dismiss survives retries but a fresh outage shows the banner again.
   */
  incidentId: number
}

export const INITIAL_SPEECH_CAPABILITIES: SpeechCapabilitiesState = {
  service: 'unknown',
  recognition: 'unknown',
  synthesis: 'unknown',
  streaming: 'unknown',
  incidentId: 0,
}

export interface SpeechHealthProbeResult {
  serviceReachable: boolean
  recognition: boolean
  synthesis: boolean
  streaming: boolean
}

const bool = (value: boolean): SpeechCapabilityStatus => (value ? 'available' : 'unavailable')

/**
 * service = available only if every reachable capability is available; degraded
 * if the service is reachable but some capability is down; unavailable if the
 * service itself is unreachable. Unknown capabilities never force a problem.
 */
function deriveService(next: {
  serviceReachable: boolean
  recognition: SpeechCapabilityStatus
  synthesis: SpeechCapabilityStatus
  streaming: SpeechCapabilityStatus
}): SpeechServiceStatus {
  if (!next.serviceReachable) return 'unavailable'
  const statuses = [next.recognition, next.synthesis, next.streaming]
  if (statuses.some((s) => s === 'unavailable')) return 'degraded'
  if (statuses.every((s) => s === 'available')) return 'available'
  return 'unknown'
}

function isProblem(service: SpeechServiceStatus): boolean {
  return service === 'degraded' || service === 'unavailable'
}

/** Carry or bump the incident counter on a healthy→problem transition. */
function withIncident(
  prev: SpeechCapabilitiesState,
  next: SpeechCapabilitiesState,
): SpeechCapabilitiesState {
  if (isProblem(next.service) && !isProblem(prev.service)) {
    return { ...next, incidentId: prev.incidentId + 1 }
  }
  return { ...next, incidentId: prev.incidentId }
}

/** Apply a successful health-check probe (per-capability, not all-or-nothing). */
export function applyHealthProbe(
  prev: SpeechCapabilitiesState,
  probe: SpeechHealthProbeResult,
  now: number,
): SpeechCapabilitiesState {
  const recognition = probe.serviceReachable ? bool(probe.recognition) : 'unavailable'
  const synthesis = probe.serviceReachable ? bool(probe.synthesis) : 'unavailable'
  const streaming = probe.serviceReachable ? bool(probe.streaming) : 'unavailable'
  const service = deriveService({
    serviceReachable: probe.serviceReachable,
    recognition,
    synthesis,
    streaming,
  })
  const next: SpeechCapabilitiesState = {
    ...prev,
    service,
    recognition,
    synthesis,
    streaming,
    lastCheckedAt: now,
    lastErrorCode: isProblem(service) ? prev.lastErrorCode : undefined,
    technicalMessage: isProblem(service) ? prev.technicalMessage : undefined,
  }
  return withIncident(prev, next)
}

/** A failed health-check: the service is unreachable/erroring. */
export function applyHealthFailure(
  prev: SpeechCapabilitiesState,
  error: SerializedSpeechError,
  now: number,
): SpeechCapabilitiesState {
  const unreachable = error.code === 'SERVICE_UNAVAILABLE' || error.code === 'REQUEST_TIMEOUT'
  const next: SpeechCapabilitiesState = {
    ...prev,
    service: unreachable ? 'unavailable' : 'degraded',
    recognition: unreachable ? 'unavailable' : prev.recognition,
    synthesis: unreachable ? 'unavailable' : prev.synthesis,
    streaming: unreachable ? 'unavailable' : prev.streaming,
    lastCheckedAt: now,
    lastErrorCode: error.code,
    technicalMessage: error.technicalMessage,
  }
  return withIncident(prev, next)
}

/** A runtime operation (ASR/TTS/streaming) failed: mark that one capability down. */
export function applyOperationError(
  prev: SpeechCapabilitiesState,
  error: SerializedSpeechError,
  now: number,
): SpeechCapabilitiesState {
  const patch: Partial<SpeechCapabilitiesState> = {}
  if (error.operation === 'recognition') patch.recognition = 'unavailable'
  else if (error.operation === 'synthesis') patch.synthesis = 'unavailable'
  else if (error.operation === 'streaming') patch.streaming = 'unavailable'
  const merged = { ...prev, ...patch }
  const service = deriveService({
    serviceReachable: error.code !== 'SERVICE_UNAVAILABLE',
    recognition: merged.recognition,
    synthesis: merged.synthesis,
    streaming: merged.streaming,
  })
  const next: SpeechCapabilitiesState = {
    ...merged,
    service,
    lastCheckedAt: now,
    lastErrorCode: error.code,
    technicalMessage: error.technicalMessage,
  }
  return withIncident(prev, next)
}

// ---- transition events (published only on state change) --------------------

export interface SpeechRuntimeEventInput {
  type: Extract<
    RuntimeEventType,
    'SpeechServiceUnavailable' | 'SpeechServiceRecovered' | 'SpeechCapabilityChanged'
  >
  detail: string
}

const CAPABILITIES: ReadonlyArray<'recognition' | 'synthesis' | 'streaming'> = [
  'recognition',
  'synthesis',
  'streaming',
]

/** Immutable facts describing what changed between two capability snapshots. */
export function diffTransitions(
  prev: SpeechCapabilitiesState,
  next: SpeechCapabilitiesState,
): SpeechRuntimeEventInput[] {
  const events: SpeechRuntimeEventInput[] = []
  if (isProblem(next.service) && !isProblem(prev.service)) {
    events.push({
      type: 'SpeechServiceUnavailable',
      detail: `service=${next.service} code=${next.lastErrorCode ?? 'unknown'}`,
    })
  } else if (!isProblem(next.service) && isProblem(prev.service)) {
    events.push({ type: 'SpeechServiceRecovered', detail: `service=${next.service}` })
  }
  for (const cap of CAPABILITIES) {
    if (
      prev[cap] !== next[cap] &&
      (prev[cap] === 'available' || next[cap] === 'available' || next[cap] === 'unavailable')
    ) {
      events.push({ type: 'SpeechCapabilityChanged', detail: `${cap}=${next[cap]}` })
    }
  }
  return events
}

// ---- user-facing copy (ТЗ §13) — no ECONNREFUSED / IP / port ---------------

const USER_MESSAGE_KEYS: Record<
  SpeechServiceErrorCode,
  { title: TranslationKey; description: TranslationKey }
> = {
  CANCELLED: {
    title: 'speech.error.unknown.title',
    description: 'speech.error.unknown.description',
  },
  SERVICE_UNAVAILABLE: {
    title: 'speech.error.serviceUnavailable.title',
    description: 'speech.error.serviceUnavailable.description',
  },
  SERVICE_ERROR: {
    title: 'speech.error.serviceError.title',
    description: 'speech.error.serviceError.description',
  },
  REQUEST_TIMEOUT: {
    title: 'speech.error.timeout.title',
    description: 'speech.error.timeout.description',
  },
  REQUEST_REJECTED: {
    title: 'speech.error.rejected.title',
    description: 'speech.error.rejected.description',
  },
  RECOGNITION_FAILED: {
    title: 'speech.error.recognitionFailed.title',
    description: 'speech.error.recognitionFailed.description',
  },
  INVALID_RESPONSE: {
    title: 'speech.error.invalidResponse.title',
    description: 'speech.error.invalidResponse.description',
  },
  UNKNOWN: {
    title: 'speech.error.unknown.title',
    description: 'speech.error.unknown.description',
  },
}

/**
 * Composite banner copy derived from which capabilities are down (ТЗ §13).
 */
export function bannerCopy(
  state: SpeechCapabilitiesState,
  locale: UiLocale = DEFAULT_UI_LOCALE,
): { title: string; description: string } | null {
  const asrDown = state.recognition === 'unavailable'
  const ttsDown = state.synthesis === 'unavailable'
  // Full outage — the whole Speech API is unreachable (ТЗ §3, §13).
  if (state.service === 'unavailable' || (asrDown && ttsDown)) {
    return {
      title: translate(locale, 'speech.error.serviceUnavailable.title'),
      description: translate(locale, 'speech.error.serviceUnavailable.description'),
    }
  }
  // Only recognition is down; synthesis still works (ТЗ §13).
  if (asrDown) {
    return {
      title: translate(locale, 'speech.banner.voiceInputUnavailable.title'),
      description: translate(locale, 'speech.banner.voiceInputUnavailable.description'),
    }
  }
  // Only synthesis is down; recognition still works (ТЗ §13).
  if (ttsDown) {
    return {
      title: translate(locale, 'speech.banner.synthesisUnavailable.title'),
      description: translate(locale, 'speech.banner.synthesisUnavailable.description'),
    }
  }
  return null
}
