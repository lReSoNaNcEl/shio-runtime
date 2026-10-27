import type {
  AvatarRuntimeFailure,
  AvatarRuntimeHealth,
  AvatarRuntimeHealthStatus,
} from '../../shared/runtime'

type HealthListener = (health: AvatarRuntimeHealth) => void

function normalizeFailure(error: unknown): AvatarRuntimeFailure {
  if (error instanceof Error) {
    return {
      name: error.name.slice(0, 100),
      message: error.message.slice(0, 500),
    }
  }
  return { name: 'Error', message: String(error).slice(0, 500) }
}

export class AvatarRuntimeHealthTracker {
  private health: AvatarRuntimeHealth

  constructor(
    private readonly onChange?: HealthListener,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.health = {
      contractVersion: 1,
      status: 'not-initialized',
      modelLoaded: false,
      presentationAttached: false,
      operational: false,
      updatedAt: this.now().toISOString(),
      lastFailure: null,
    }
  }

  getSnapshot(): AvatarRuntimeHealth {
    return {
      ...this.health,
      lastFailure: this.health.lastFailure && { ...this.health.lastFailure },
    }
  }

  reportCurrent(): void {
    this.onChange?.(this.getSnapshot())
  }

  setPresentationAttached(attached: boolean): void {
    this.update({ presentationAttached: attached })
  }

  markLoading(): void {
    this.update({ status: 'loading', modelLoaded: false, lastFailure: null })
  }

  markReady(modelLoaded: boolean): void {
    this.update({
      status: modelLoaded ? 'ready' : 'failed',
      modelLoaded,
      lastFailure: modelLoaded
        ? null
        : { name: 'AvatarRuntimeError', message: 'VRM load completed without a model' },
    })
  }

  markFailed(error: unknown, modelLoaded: boolean): void {
    this.update({ status: 'failed', modelLoaded, lastFailure: normalizeFailure(error) })
  }

  markDisposed(): void {
    this.update({ status: 'disposed', modelLoaded: false, presentationAttached: false })
  }

  setDiagnostics(
    motion: AvatarRuntimeHealth['motion'],
    speech: AvatarRuntimeHealth['speech'],
    embodimentAvailability?: AvatarRuntimeHealth['embodimentAvailability'],
  ): void {
    this.update({ motion, speech, embodimentAvailability })
  }

  private update(
    patch: Partial<
      Pick<
        AvatarRuntimeHealth,
        | 'lastFailure'
        | 'modelLoaded'
        | 'presentationAttached'
        | 'status'
        | 'motion'
        | 'speech'
        | 'embodimentAvailability'
      >
    >,
  ): void {
    if (this.health.status === 'disposed') return
    const status: AvatarRuntimeHealthStatus = patch.status ?? this.health.status
    const modelLoaded = patch.modelLoaded ?? this.health.modelLoaded
    const presentationAttached = patch.presentationAttached ?? this.health.presentationAttached
    const motion = patch.motion ?? this.health.motion
    this.health = {
      ...this.health,
      ...patch,
      status,
      modelLoaded,
      presentationAttached,
      operational:
        status === 'ready' &&
        modelLoaded &&
        (motion
          ? !motion.error && (motion.state === 'ready' || motion.state === 'mirror')
          : presentationAttached),
      updatedAt: this.now().toISOString(),
    }
    this.onChange?.(this.getSnapshot())
  }
}
