import * as THREE from 'three'
import { facialTuning } from './avatarTuning'
import type { VrmAnimationLoadContext, VrmBodyActionDebugEntry, VrmTransitionFrameTraceEntry } from './VrmModel'

interface BodyActionTrace {
  label: string
  name: string
  actionInstanceId: number
  clipInstanceId: number
  weight: number
  enabled: boolean
  paused: boolean
  time: number
  running: boolean
  fadingOut: boolean
  current: boolean
  previous: boolean
}

export interface AnimationDiagnosticsState {
  vrm: VRMProbe | null
  mixer: THREE.AnimationMixer | null
  bodyActions: Set<THREE.AnimationAction>
  fadingOutActions: Map<THREE.AnimationAction, { clip: THREE.AnimationClip; startAt?: number; endAt: number }>
  bodyActionNames: WeakMap<THREE.AnimationAction, string>
  currentBodyAction: THREE.AnimationAction | null
  previousBodyAction: THREE.AnimationAction | null
  lastLoadContext: VrmAnimationLoadContext | null
  bodyFrame: number
  bodyClockTime: number
  transitionEndTime: number
  cleanupAllowedAfterFrame: number
  hipsDeltaY: number
  rootDeltaY: number
}

interface VRMProbe {
  scene: THREE.Object3D
  humanoid?: {
    getRawBoneNode(name: string): THREE.Object3D | null
  }
}

export class AnimationDiagnostics {
  private bodyActionIds = new WeakMap<THREE.AnimationAction, number>()
  private bodyClipIds = new WeakMap<THREE.AnimationClip, number>()
  private nextBodyClipId = 0
  private lastTraceSignature = ''
  private actionInfluenceProbe: {
    action: THREE.AnimationAction
    animationId: string
    file: string
    startedFrame: number
    firstBoneChangeFrame: number | null
    rootQuaternionAtPlay: THREE.Quaternion
    hipsQuaternionAtPlay: THREE.Quaternion
    loggedFirstChange: boolean
  } | null = null
  private frameTrace: VrmTransitionFrameTraceEntry[] = []
  private readonly poseProbeEpsilon = 0.00001
  private readonly weightGapThreshold = 0.95

  lastTransitionEvent = 'none'
  nextBodyActionId = 0

  constructor(private readonly getState: () => AnimationDiagnosticsState) {}

  reset(): void {
    this.lastTransitionEvent = 'none'
    this.lastTraceSignature = ''
    this.actionInfluenceProbe = null
    this.frameTrace = []
    this.nextBodyActionId = 0
    this.nextBodyClipId = 0
  }

  assignActionId(action: THREE.AnimationAction): number {
    const id = ++this.nextBodyActionId
    this.bodyActionIds.set(action, id)
    return id
  }

  getFrameTrace(): VrmTransitionFrameTraceEntry[] {
    return [...this.frameTrace]
  }

  recordFrameTrace(label: string): void {
    const state = this.getState()
    const actionCount = (state.mixer as unknown as { _actions?: unknown[] } | null)?._actions?.length ?? 0
    const actions = this.getBodyActionDebugEntries()
    const mixerActions = this.getMixerActionDebugEntries()
    const totalEffectiveWeight = mixerActions.reduce((sum, action) => sum + action.weight, 0)
    const weightedActionCount = mixerActions.filter((action) => action.weight > 0.01).length
    const currentWeight = state.currentBodyAction?.getEffectiveWeight() ?? 0
    const pose = this.getSkeletonPoseTrace()
    const probe = this.actionInfluenceProbe
    const firstBoneChangeAfterPlayFrame = probe?.firstBoneChangeFrame ?? null
    const framesSincePlayWithoutBoneChange =
      probe && probe.firstBoneChangeFrame === null ? Math.max(0, state.bodyFrame - probe.startedFrame) : null
    const hasWeightGap = mixerActions.length > 0 && totalEffectiveWeight < this.weightGapThreshold
    const hasZeroWeightedActions = mixerActions.length > 0 && weightedActionCount === 0
    const currentActionInfluential = Boolean(
      state.currentBodyAction &&
        currentWeight > 0.01 &&
        (!probe || probe.action !== state.currentBodyAction || probe.firstBoneChangeFrame !== null)
    )
    if (hasZeroWeightedActions || hasWeightGap || (state.currentBodyAction && currentWeight > 0.01 && framesSincePlayWithoutBoneChange !== null && framesSincePlayWithoutBoneChange > 1)) {
      console.warn(
        `[ANIMLIFE] anomaly label="${label}" frame=${state.bodyFrame} animation=${state.lastLoadContext?.animationId ?? 'none'} mixerActions=${actionCount} bodyActions=${state.bodyActions.size} weighted=${weightedActionCount} totalWeight=${totalEffectiveWeight.toFixed(3)} currentWeight=${currentWeight.toFixed(3)} framesSincePlayWithoutBoneChange=${framesSincePlayWithoutBoneChange ?? 'n/a'} rootQ=${pose.localRootQuaternion} hipsQ=${pose.hipsQuaternion} mixer=${JSON.stringify(mixerActions)} body=${JSON.stringify(actions)}`
      )
    }
    this.frameTrace = [
      ...this.frameTrace,
      {
        at: Date.now(),
        frame: state.bodyFrame,
        label,
        animationId: state.lastLoadContext?.animationId ?? null,
        previousAnimationId: state.lastLoadContext?.previousAnimationId ?? null,
        mixerActionCount: actionCount,
        bodyActionCount: state.bodyActions.size,
        weightedActionCount,
        totalEffectiveWeight: Number(totalEffectiveWeight.toFixed(3)),
        hasWeightGap,
        hasZeroWeightedActions,
        currentActionInfluential,
        currentWeight: Number(currentWeight.toFixed(3)),
        previousWeight: Number((state.previousBodyAction?.getEffectiveWeight() ?? 0).toFixed(3)),
        transitionRemaining: Number(Math.max(0, state.transitionEndTime - state.bodyClockTime).toFixed(3)),
        cleanupState: `fading=${state.fadingOutActions.size};graceUntil=${state.cleanupAllowedAfterFrame}`,
        localRootQuaternion: pose.localRootQuaternion,
        hipsQuaternion: pose.hipsQuaternion,
        firstBoneChangeAfterPlayFrame,
        framesSincePlayWithoutBoneChange,
        hipsDeltaY: Number(state.hipsDeltaY.toFixed(4)),
        rootDeltaY: Number(state.rootDeltaY.toFixed(4)),
        mixerActions,
        actions
      }
    ].slice(-140)
  }

  traceAction(action: THREE.AnimationAction, label: string): BodyActionTrace {
    const state = this.getState()
    const clip = action.getClip()
    return {
      label,
      name: state.bodyActionNames.get(action) ?? clip.name ?? 'unnamed',
      actionInstanceId: this.bodyActionIds.get(action) ?? 0,
      clipInstanceId: this.ensureClipInstanceId(clip),
      weight: Number(action.getEffectiveWeight().toFixed(3)),
      enabled: action.enabled,
      paused: action.paused,
      time: Number(action.time.toFixed(3)),
      running: action.isRunning(),
      fadingOut: state.fadingOutActions.has(action),
      current: action === state.currentBodyAction,
      previous: action === state.previousBodyAction
    }
  }

  logAnimationTransition(label: string, context?: Partial<VrmAnimationLoadContext>): void {
    const state = this.getState()
    const actionCount = (state.mixer as unknown as { _actions?: unknown[] } | null)?._actions?.length ?? 0
    const actions = [...state.bodyActions].map((action) => this.traceAction(action, label))
    const previous = state.previousBodyAction ? this.traceAction(state.previousBodyAction, `${label}:previous`) : null
    const current = state.currentBodyAction ? this.traceAction(state.currentBodyAction, `${label}:current`) : null
    const oldWeight = state.previousBodyAction?.getEffectiveWeight() ?? 0
    const newWeight = state.currentBodyAction?.getEffectiveWeight() ?? 0
    const signature = [
      label,
      context?.animationId ?? state.lastLoadContext?.animationId ?? 'none',
      context?.previousAnimationId ?? state.lastLoadContext?.previousAnimationId ?? 'none',
      actionCount,
      state.bodyActions.size,
      oldWeight.toFixed(2),
      newWeight.toFixed(2),
      state.fadingOutActions.size
    ].join('|')
    const eventDriven =
      facialTuning.animation.verboseTransitionLogs ||
      signature !== this.lastTraceSignature ||
      /loadAnimation|stopAnimation|cleanup|ownership gap|settled/.test(label)
    if (!eventDriven) return
    this.lastTraceSignature = signature
    this.lastTransitionEvent = `${label} ${context?.animationId ?? state.lastLoadContext?.animationId ?? 'none'}`
    console.log(
      `[ANIMDBG] transition ${label} frame=${context?.frame ?? state.bodyFrame} animation=${context?.animationId ?? state.lastLoadContext?.animationId ?? 'none'} prev=${context?.previousAnimationId ?? state.lastLoadContext?.previousAnimationId ?? 'none'} mixerActions=${actionCount} bodyActions=${state.bodyActions.size} oldWeight=${oldWeight.toFixed(3)} newWeight=${newWeight.toFixed(3)} transitionRemaining=${Math.max(0, state.transitionEndTime - state.bodyClockTime).toFixed(3)} current=${current ? JSON.stringify(current) : 'none'} previous=${previous ? JSON.stringify(previous) : 'none'} actions=${JSON.stringify(actions)}`
    )
  }

  updateActionInfluenceProbe(label: string): void {
    const state = this.getState()
    const probe = this.actionInfluenceProbe
    if (!probe || probe.firstBoneChangeFrame !== null) return
    const pose = this.getPoseProbeQuaternions()
    const rootAngle = probe.rootQuaternionAtPlay.angleTo(pose.root)
    const hipsAngle = probe.hipsQuaternionAtPlay.angleTo(pose.hips)
    const changed = rootAngle > this.poseProbeEpsilon || hipsAngle > this.poseProbeEpsilon
    if (!changed) return

    probe.firstBoneChangeFrame = state.bodyFrame
    if (!probe.loggedFirstChange) {
      probe.loggedFirstChange = true
      console.log(
        `[ANIMLIFE] first bone change label="${label}" frame=${state.bodyFrame} framesSincePlay=${state.bodyFrame - probe.startedFrame} animation=${probe.animationId} file=${probe.file} rootAngle=${rootAngle.toFixed(6)} hipsAngle=${hipsAngle.toFixed(6)} rootQ=${this.formatQuaternion(pose.root)} hipsQ=${this.formatQuaternion(pose.hips)}`
      )
    }
  }

  startActionInfluenceProbe(action: THREE.AnimationAction, context: VrmAnimationLoadContext): void {
    const state = this.getState()
    const pose = this.getPoseProbeQuaternions()
    this.actionInfluenceProbe = {
      action,
      animationId: context.animationId,
      file: context.file,
      startedFrame: state.bodyFrame,
      firstBoneChangeFrame: null,
      rootQuaternionAtPlay: pose.root,
      hipsQuaternionAtPlay: pose.hips,
      loggedFirstChange: false
    }
    console.log(
      `[ANIMLIFE] play probe start frame=${state.bodyFrame} animation=${context.animationId} file=${context.file} actionId=${this.bodyActionIds.get(action) ?? 'pending'} rootQ=${this.formatQuaternion(pose.root)} hipsQ=${this.formatQuaternion(pose.hips)}`
    )
  }

  getBodyActionDebugEntries(): VrmBodyActionDebugEntry[] {
    const state = this.getState()
    return [...state.bodyActions].map((action) => {
      const clip = action.getClip()
      const weight = action.getEffectiveWeight()
      return {
        name: state.bodyActionNames.get(action) ?? clip.name ?? 'unnamed',
        actionInstanceId: this.bodyActionIds.get(action) ?? 0,
        clipInstanceId: this.ensureClipInstanceId(clip),
        weight,
        time: action.time,
        duration: clip.duration,
        enabled: action.enabled,
        running: action.isRunning(),
        fadingOut: state.fadingOutActions.has(action),
        current: action === state.currentBodyAction,
        previous: action === state.previousBodyAction
      }
    })
  }

  getMixerActionDebugEntries(): VrmBodyActionDebugEntry[] {
    const state = this.getState()
    const mixerActions = ((state.mixer as unknown as { _actions?: THREE.AnimationAction[] } | null)?._actions ?? [])
    return mixerActions.map((action) => {
      const clip = action.getClip()
      return {
        name: state.bodyActionNames.get(action) ?? clip.name ?? 'unnamed',
        actionInstanceId: this.bodyActionIds.get(action) ?? 0,
        clipInstanceId: this.ensureClipInstanceId(clip),
        weight: action.getEffectiveWeight(),
        time: action.time,
        duration: clip.duration,
        enabled: action.enabled,
        running: action.isRunning(),
        fadingOut: state.fadingOutActions.has(action),
        current: action === state.currentBodyAction,
        previous: action === state.previousBodyAction
      }
    })
  }

  getSkeletonPoseTrace(): { localRootQuaternion: string; hipsQuaternion: string } {
    const state = this.getState()
    const rootQuaternion = state.vrm?.scene.quaternion
    const hipsQuaternion = state.vrm?.humanoid?.getRawBoneNode('hips')?.quaternion
    return {
      localRootQuaternion: rootQuaternion ? this.formatQuaternion(rootQuaternion) : 'none',
      hipsQuaternion: hipsQuaternion ? this.formatQuaternion(hipsQuaternion) : 'none'
    }
  }

  formatQuaternion(quaternion: THREE.Quaternion): string {
    return `${quaternion.x.toFixed(5)},${quaternion.y.toFixed(5)},${quaternion.z.toFixed(5)},${quaternion.w.toFixed(5)}`
  }

  formatEuler(euler: THREE.Euler): string {
    return `${euler.x.toFixed(2)},${euler.y.toFixed(2)},${euler.z.toFixed(2)}`
  }

  ensureClipInstanceId(clip: THREE.AnimationClip): number {
    const existing = this.bodyClipIds.get(clip)
    if (existing) return existing
    const id = ++this.nextBodyClipId
    this.bodyClipIds.set(clip, id)
    return id
  }

  private getPoseProbeQuaternions(): { root: THREE.Quaternion; hips: THREE.Quaternion } {
    const state = this.getState()
    return {
      root: state.vrm?.scene.quaternion.clone() ?? new THREE.Quaternion(),
      hips: state.vrm?.humanoid?.getRawBoneNode('hips')?.quaternion.clone() ?? new THREE.Quaternion()
    }
  }
}
