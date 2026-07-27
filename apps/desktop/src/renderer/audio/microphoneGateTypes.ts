/**
 * The set of attention modes whose runtime requires a working microphone.
 * All existing attention modes drive continuous audio capture (Silero VAD +
 * ASR), so every value is microphone-dependent; enabling/disabling streaming is
 * a separate `enabled` flag, not one of these values.
 */
export type StreamingModeId = 'default'

/**
 * What the user was trying to start when the microphone prerequisite guard ran.
 * A one-shot voice-input intent is deliberately distinct from a continuous
 * streaming-mode intent so the two are never conflated.
 */
export type MicrophoneIntent =
  | { type: 'start-streaming'; modeId: StreamingModeId }
  | { type: 'start-voice-input' }

/** Normalized, user-safe classification of a microphone failure. */
export type MicrophoneFailureReason =
  | 'permission-denied'
  | 'device-missing'
  | 'device-busy'
  | 'constraints-invalid'
  | 'unknown'

/** Why the microphone gate was opened. Drives overlay copy independently of `error`. */
export type MicrophoneGateOpenReason =
  | 'not-configured'
  | 'saved-device-missing'
  | 'saved-device-invalid'
  | 'active-device-lost'
  | 'runtime-start-failed'

export interface MicrophoneOption {
  deviceId: string
  label: string
}

/**
 * Explicit gate state machine. Deliberately a discriminated union rather than a
 * bag of booleans so contradictory combinations are unrepresentable.
 */
export type MicrophoneGateState =
  | { status: 'closed' }
  | { status: 'loading-devices'; intent: MicrophoneIntent; reason: MicrophoneGateOpenReason }
  | {
      status: 'selecting'
      intent: MicrophoneIntent
      reason: MicrophoneGateOpenReason
      devices: MicrophoneOption[]
      selectedDeviceId: string | null
      error: MicrophoneFailureReason | null
    }
  | {
      status: 'validating'
      intent: MicrophoneIntent
      reason: MicrophoneGateOpenReason
      devices: MicrophoneOption[]
      selectedDeviceId: string
    }

/** Outcome returned to the intent owner (Controller). */
export type MicrophoneGateResult =
  | { status: 'confirmed'; intent: MicrophoneIntent; deviceId: string }
  | { status: 'cancelled'; intent: MicrophoneIntent }

/**
 * Debug-only surface. Native DOM error names / constraints live here, never in
 * the user-facing gate state.
 */
export interface MicrophoneGateDebugState {
  gateStatus: MicrophoneGateState['status']
  pendingIntent: MicrophoneIntent | null
  openReason: MicrophoneGateOpenReason | null
  selectedDeviceLabel: string | null
  lastFailureReason: MicrophoneFailureReason | null
  lastNativeErrorName: string | null
  lastConstraint: string | null
  lastValidationSucceeded: boolean | null
}

/** The empty/default state. */
export const CLOSED_GATE: MicrophoneGateState = { status: 'closed' }

/**
 * True when `deviceId` refers to the OS default rather than a concrete hardware
 * device. The project stores `''` for the system default and legacy code
 * compares against the literal `'default'`, so both are treated as "default"
 * and must not be validated by exact hardware-id match.
 */
export function isDefaultMicrophone(deviceId: string): boolean {
  return deviceId === '' || deviceId === 'default'
}
