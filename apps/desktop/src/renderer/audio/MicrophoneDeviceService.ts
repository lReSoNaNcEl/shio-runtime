import {
  isDefaultMicrophone,
  type MicrophoneFailureReason,
  type MicrophoneOption,
} from './microphoneGateTypes'

/**
 * Details of a normalized microphone failure. The user-facing `reason` is safe
 * to render; `nativeName` and `constraint` are for logs / Debug UI only and must
 * never reach the product UI.
 */
export interface MicrophoneFailure {
  reason: MicrophoneFailureReason
  nativeName: string | null
  constraint: string | null
}

/**
 * Stateless helper that owns all direct interaction with `enumerateDevices()`
 * and the *probe* `getUserMedia()` used to validate a device before a
 * microphone-dependent runtime starts. It never keeps a working stream alive:
 * every probe stream is stopped immediately. Speech Runtime remains the sole
 * owner of the real working audio stream.
 */
export class MicrophoneDeviceService {
  constructor(private readonly fallbackLabel: (index: number) => string) {}

  /**
   * Current audio input devices. Devices without a readable label (before the
   * first permission grant) still count as real devices and get a fallback
   * caption; a missing label is never treated as a missing device.
   */
  async listInputs(): Promise<MicrophoneOption[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    let fallbackIndex = 0
    return devices
      .filter((device) => device.kind === 'audioinput')
      .map((device) => {
        const label = device.label.trim()
        return {
          deviceId: device.deviceId,
          label: label || this.fallbackLabel(++fallbackIndex),
        }
      })
  }

  /**
   * Whether `deviceId` is currently present among audio inputs. The system
   * default is always considered present — there is no concrete hardware id to
   * match against.
   */
  async hasDevice(deviceId: string): Promise<boolean> {
    if (isDefaultMicrophone(deviceId)) return true
    const inputs = await this.listInputs()
    return inputs.some((input) => input.deviceId === deviceId)
  }

  /**
   * Probe the device by opening a short-lived stream and stopping it at once.
   *
   * `getUserMedia()` cannot be aborted mid-flight, so instead of an
   * `AbortSignal` the caller passes a monotonic `operationId` plus a predicate.
   * If the operation is no longer current by the time the stream resolves (the
   * user cancelled, chose another device, or a newer request superseded it), the
   * late stream is stopped and the call returns without signalling success.
   *
   * Resolves when the probe stream opened and belonged to the current operation.
   * Rejects with the raw error so the caller can normalize it.
   */
  async validate(
    deviceId: string,
    operationId: number,
    isOperationCurrent: (operationId: number) => boolean,
  ): Promise<void> {
    const audio: MediaTrackConstraints = isDefaultMicrophone(deviceId)
      ? {}
      : { deviceId: { exact: deviceId } }
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false })
    // A probe stream must never outlive the probe — regardless of whether the
    // operation is still current — so it cannot race the real working stream.
    stream.getTracks().forEach((track) => {
      track.stop()
    })
    if (!isOperationCurrent(operationId)) {
      throw new StaleValidationError()
    }
  }

  /** Map a raw getUserMedia error to a user-safe reason plus debug metadata. */
  normalizeFailure(error: unknown): MicrophoneFailure {
    const name = error instanceof Error ? error.name : null
    const message = error instanceof Error ? error.message : String(error)
    const constraint =
      error && typeof error === 'object' && 'constraint' in error
        ? String((error as { constraint?: unknown }).constraint ?? '') || null
        : null

    let reason: MicrophoneFailureReason
    switch (name) {
      case 'NotAllowedError':
      case 'SecurityError':
        reason = 'permission-denied'
        break
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        reason = 'device-missing'
        break
      case 'NotReadableError':
      case 'TrackStartError':
        reason = 'device-busy'
        break
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        reason = 'constraints-invalid'
        break
      default:
        reason = 'unknown'
    }

    // Technical detail is preserved in logs / Debug UI only, never surfaced to
    // the product UI.
    console.error('[MicrophoneGate] Failed to validate microphone', {
      name,
      message,
      constraint,
    })

    return { reason, nativeName: name, constraint }
  }
}

/**
 * Thrown by {@link MicrophoneDeviceService.validate} when a probe succeeded but
 * its operation was superseded. Callers treat it as a silent no-op, not a
 * user-facing failure.
 */
export class StaleValidationError extends Error {
  constructor() {
    super('microphone validation superseded')
    this.name = 'StaleValidationError'
  }
}
