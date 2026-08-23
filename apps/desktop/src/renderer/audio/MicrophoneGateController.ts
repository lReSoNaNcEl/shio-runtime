import { observeRendererPromise } from '../reliability/observePromise'
import {
  type MicrophoneDeviceService,
  type MicrophoneFailure,
  StaleValidationError,
} from './MicrophoneDeviceService'
import {
  CLOSED_GATE,
  isDefaultMicrophone,
  type MicrophoneFailureReason,
  type MicrophoneGateDebugState,
  type MicrophoneGateOpenReason,
  type MicrophoneGateResult,
  type MicrophoneGateState,
  type MicrophoneIntent,
} from './microphoneGateTypes'

export interface MicrophoneGateControllerDeps {
  service: MicrophoneDeviceService
  /** Reads the persisted selected device id (single source of truth). */
  getSavedDeviceId: () => string
  /** Called whenever the observable gate state changes. */
  onStateChange: (state: MicrophoneGateState) => void
  /** Optional diagnostics sink (never receives audio data). */
  recordEvent?: (label: string, detail?: string) => void
}

/**
 * Single owner of the microphone prerequisite gate: saved-device validation,
 * gate presentation, device selection, probe validation, and returning a
 * confirmed/cancelled intent. It does NOT execute the intent (Controller does)
 * and never owns the working audio stream (Speech Runtime does).
 *
 * Lifecycle belongs to the main Controller, not to any React component: it owns
 * the `devicechange` listener and is torn down via {@link dispose}.
 */
export class MicrophoneGateController {
  private readonly service: MicrophoneDeviceService
  private readonly getSavedDeviceId: () => string
  private readonly onStateChange: (state: MicrophoneGateState) => void
  private readonly recordEvent?: (label: string, detail?: string) => void

  private state: MicrophoneGateState = CLOSED_GATE
  private pending: {
    intent: MicrophoneIntent
    reason: MicrophoneGateOpenReason
    resolve: (result: MicrophoneGateResult) => void
    promise: Promise<MicrophoneGateResult>
  } | null = null

  /** Monotonic guard: cancel, new request, or a new device selection bumps it. */
  private operationId = 0
  private disposed = false
  private readonly handleDeviceChange = (): void => {
    this.runBackground(this.onDeviceChange(), 'handle microphone device change')
  }

  private debug: MicrophoneGateDebugState = {
    gateStatus: 'closed',
    pendingIntent: null,
    openReason: null,
    selectedDeviceLabel: null,
    lastFailureReason: null,
    lastNativeErrorName: null,
    lastConstraint: null,
    lastValidationSucceeded: null,
  }

  constructor(deps: MicrophoneGateControllerDeps) {
    this.service = deps.service
    this.getSavedDeviceId = deps.getSavedDeviceId
    this.onStateChange = deps.onStateChange
    this.recordEvent = deps.recordEvent
    navigator.mediaDevices.addEventListener('devicechange', this.handleDeviceChange)
  }

  getState(): MicrophoneGateState {
    return this.state
  }

  getDebugState(): MicrophoneGateDebugState {
    return this.debug
  }

  /**
   * Single microphone prerequisite check for a given intent.
   *
   * For a fresh user attempt (`not-configured`), the saved device is checked
   * first and, if usable, confirmed without ever showing the gate. Reopen
   * reasons (`runtime-start-failed`, `active-device-lost`, `saved-device-*`) and
   * any `initialError` force the gate open directly with the supplied reason.
   *
   * Repeated calls while a request is pending never raise a second gate:
   * the same intent returns the existing promise; a different intent resolves
   * immediately as cancelled.
   */
  request(
    intent: MicrophoneIntent,
    reason: MicrophoneGateOpenReason,
    initialError?: MicrophoneFailureReason,
  ): Promise<MicrophoneGateResult> {
    if (this.disposed) return Promise.resolve({ status: 'cancelled', intent })
    if (this.pending) {
      if (sameIntent(this.pending.intent, intent)) return this.pending.promise
      // A different intent must not replace the current one nor leave a second
      // promise hanging.
      return Promise.resolve({ status: 'cancelled', intent })
    }

    let resolve!: (result: MicrophoneGateResult) => void
    const promise = new Promise<MicrophoneGateResult>((res) => {
      resolve = res
    })
    this.pending = { intent, reason, resolve, promise }
    this.recordEvent?.('Microphone Gate Request', `${describeIntent(intent)}:${reason}`)

    const forceOpen =
      reason === 'runtime-start-failed' || reason === 'active-device-lost' || initialError != null
    if (forceOpen) {
      this.runBackground(
        this.openGate(intent, reason, initialError ?? null),
        'open microphone gate',
      )
    } else {
      this.runBackground(this.checkSavedDeviceThenOpen(intent), 'check saved microphone')
    }
    return promise
  }

  /** User picked a device in the gate. Supersedes any in-flight validation. */
  selectDevice(deviceId: string): void {
    if (this.state.status !== 'selecting' && this.state.status !== 'validating') return
    // A new selection invalidates any in-flight probe.
    this.operationId += 1
    this.setState({
      status: 'selecting',
      intent: this.state.intent,
      reason: this.state.reason,
      devices: this.state.devices,
      selectedDeviceId: deviceId,
      error: null,
    })
  }

  /** Re-enumerate devices while the gate is open. */
  async refreshDevices(): Promise<void> {
    if (this.state.status !== 'selecting' && this.state.status !== 'validating') return
    const { intent, reason, selectedDeviceId: previousSelected } = this.state
    const previousError = this.state.status === 'selecting' ? this.state.error : null
    const devices = await this.service.listInputs()
    if (this.state.status !== 'selecting' && this.state.status !== 'validating') return
    const selectedDeviceId =
      previousSelected && devices.some((d) => d.deviceId === previousSelected)
        ? previousSelected
        : null
    this.setState({
      status: 'selecting',
      intent,
      reason,
      devices,
      selectedDeviceId,
      error: previousError,
    })
  }

  /** Validate the selected device and, on success, confirm the intent. */
  async validateAndContinue(): Promise<void> {
    if (this.state.status !== 'selecting' || !this.state.selectedDeviceId) return
    const { intent, reason, devices, selectedDeviceId } = this.state
    const operationId = ++this.operationId
    this.setState({ status: 'validating', intent, reason, devices, selectedDeviceId })
    try {
      await this.service.validate(selectedDeviceId, operationId, (id) =>
        this.isOperationCurrent(id),
      )
      this.recordValidationSuccess(selectedDeviceId)
      this.confirm(intent, selectedDeviceId)
    } catch (error) {
      if (error instanceof StaleValidationError) return
      const failure = this.service.normalizeFailure(error)
      this.recordValidationFailure(failure)
      if (!this.isOperationCurrent(operationId)) return
      this.setState({
        status: 'selecting',
        intent,
        reason,
        devices,
        selectedDeviceId,
        error: failure.reason,
      })
    }
  }

  /** Cancel the current request. Escape / backdrop-close route here. */
  cancel(): void {
    const pending = this.pending
    if (!pending) return
    this.operationId += 1
    this.recordEvent?.('Microphone Gate Cancelled', describeIntent(pending.intent))
    this.finish({ status: 'cancelled', intent: pending.intent })
  }

  /**
   * Tear down. Removes the `devicechange` listener, invalidates any in-flight
   * operation, and resolves a pending request as cancelled so no promise hangs.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    navigator.mediaDevices.removeEventListener('devicechange', this.handleDeviceChange)
    this.operationId += 1
    if (this.pending) this.finish({ status: 'cancelled', intent: this.pending.intent })
  }

  // ---- internals -----------------------------------------------------------

  private isOperationCurrent(operationId: number): boolean {
    return !this.disposed && operationId === this.operationId
  }

  private async checkSavedDeviceThenOpen(intent: MicrophoneIntent): Promise<void> {
    const saved = this.getSavedDeviceId()
    const operationId = ++this.operationId
    const present = await this.service.hasDevice(saved)
    if (!this.isOperationCurrent(operationId) || this.pending?.intent !== intent) return
    if (!present) {
      await this.openGate(
        intent,
        isDefaultMicrophone(saved) ? 'not-configured' : 'saved-device-missing',
        null,
      )
      return
    }
    try {
      await this.service.validate(saved, operationId, (id) => this.isOperationCurrent(id))
      this.recordValidationSuccess(saved)
      this.confirm(intent, saved)
    } catch (error) {
      if (error instanceof StaleValidationError) return
      const failure = this.service.normalizeFailure(error)
      this.recordValidationFailure(failure)
      if (!this.isOperationCurrent(operationId)) return
      const reason: MicrophoneGateOpenReason = isDefaultMicrophone(saved)
        ? 'not-configured'
        : 'saved-device-invalid'
      await this.openGate(intent, reason, failure.reason)
    }
  }

  private async openGate(
    intent: MicrophoneIntent,
    reason: MicrophoneGateOpenReason,
    initialError: MicrophoneFailureReason | null,
  ): Promise<void> {
    if (this.pending?.intent !== intent) return
    this.setState({ status: 'loading-devices', intent, reason })
    const devices = await this.service.listInputs()
    if (this.pending?.intent !== intent || this.state.status !== 'loading-devices') return
    const saved = this.getSavedDeviceId()
    const selectedDeviceId =
      !isDefaultMicrophone(saved) && devices.some((d) => d.deviceId === saved) ? saved : null
    this.setState({
      status: 'selecting',
      intent,
      reason,
      devices,
      selectedDeviceId,
      error: initialError,
    })
    this.recordEvent?.('Microphone Gate Opened', `${describeIntent(intent)}:${reason}`)
  }

  private async onDeviceChange(): Promise<void> {
    if (this.disposed) return
    // Only meaningful while the gate is open. Never touches the working stream.
    if (this.state.status !== 'selecting' && this.state.status !== 'validating') return
    await this.refreshDevices()
  }

  private confirm(intent: MicrophoneIntent, deviceId: string): void {
    this.finish({ status: 'confirmed', intent, deviceId })
  }

  private finish(result: MicrophoneGateResult): void {
    const pending = this.pending
    this.pending = null
    this.setState(CLOSED_GATE)
    pending?.resolve(result)
  }

  private setState(next: MicrophoneGateState): void {
    this.state = next
    this.debug = {
      ...this.debug,
      gateStatus: next.status,
      pendingIntent: this.pending?.intent ?? null,
      openReason: next.status === 'closed' ? null : next.reason,
      selectedDeviceLabel: this.selectedLabel(next),
    }
    if (!this.disposed) this.onStateChange(next)
  }

  private runBackground(promise: Promise<void>, context: string): void {
    observeRendererPromise(promise, context, (error) => {
      this.recordEvent?.('Microphone Gate Error', String(error))
      if (this.pending) this.finish({ status: 'cancelled', intent: this.pending.intent })
    })
  }

  private selectedLabel(state: MicrophoneGateState): string | null {
    if (state.status !== 'selecting' && state.status !== 'validating') return null
    const selected = state.selectedDeviceId
    if (!selected) return null
    return state.devices.find((d) => d.deviceId === selected)?.label ?? null
  }

  private recordValidationSuccess(deviceId: string): void {
    this.debug = {
      ...this.debug,
      lastValidationSucceeded: true,
      lastFailureReason: null,
      lastNativeErrorName: null,
      lastConstraint: null,
    }
    this.recordEvent?.(
      'Microphone Validation Succeeded',
      isDefaultMicrophone(deviceId) ? 'default' : 'device',
    )
  }

  private recordValidationFailure(failure: MicrophoneFailure): void {
    this.debug = {
      ...this.debug,
      lastValidationSucceeded: false,
      lastFailureReason: failure.reason,
      lastNativeErrorName: failure.nativeName,
      lastConstraint: failure.constraint,
    }
    this.recordEvent?.('Microphone Validation Failed', failure.reason)
  }
}

function sameIntent(a: MicrophoneIntent, b: MicrophoneIntent): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'start-streaming' && b.type === 'start-streaming') return a.modeId === b.modeId
  return true
}

function describeIntent(intent: MicrophoneIntent): string {
  return intent.type === 'start-streaming'
    ? `start-streaming:${intent.modeId}`
    : 'start-voice-input'
}
