import type { AvatarRuntimeHealth, CharacterState, RuntimeEvent } from '../../shared/runtime'
import type { SpeechPolishDebugState } from '../../shared/speech'
import type { AudioPlayer } from '../audio/audioPlayer'
import type { MicrophoneGateDebugState } from '../audio/microphoneGateTypes'
import type { BacklogSelectorDiagnostics } from '../conversation/admission/BacklogSelector'
import type { AvatarRuntimeDebugState } from '../runtime/AvatarRuntime'
import {
  type RuntimeHealth,
  RuntimeStateInvariantValidator,
} from '../runtime/RuntimeStateInvariantValidator'
import type { SpeechStateTimelineEntry } from '../runtime/SpeechRuntime'
import { TransitionRecorder } from '../runtime/TransitionRecorder'
import type { ControllerState, RuntimeDebugSnapshot, RuntimeTimelineEvent } from './contracts'

export interface RuntimeDiagnosticsDependencies {
  getControllerState(): ControllerState
  getCharacterState(): CharacterState
  getAvatarDebugState(): AvatarRuntimeDebugState
  getAvatarRuntimeHealth(): AvatarRuntimeHealth
  getPlaybackDebug(): ReturnType<AudioPlayer['getPlaybackDebug']>
  getOverlayDebugState(): Promise<string>
  getEventHistory(): readonly RuntimeEvent[]
  getSpeechTimeline(): SpeechStateTimelineEntry[]
  getSpeechPolishDebugState(): SpeechPolishDebugState
  getMicrophoneGateDebug(): MicrophoneGateDebugState
  getBacklogDiagnostics(): BacklogSelectorDiagnostics
  isAvatarLoaded(): boolean
  createId(): string
  now(): number
  performanceNow(): number
}

export class RuntimeDiagnosticsProjection {
  private timeline: RuntimeTimelineEvent[] = []
  private lastAvatarEmotion = 'none'
  private lastTtsLatencyMs = 'none'
  private lastTtsCache = 'none'
  private invariantValidator = new RuntimeStateInvariantValidator()
  private transitionRecorder = new TransitionRecorder()
  private lastValidationAt = 0

  constructor(private readonly dependencies: RuntimeDiagnosticsDependencies) {}

  record(label: string, detail?: string): void {
    this.timeline = [
      ...this.timeline,
      {
        id: this.dependencies.createId(),
        at: this.dependencies.now(),
        label,
        detail,
      },
    ].slice(-80)
  }

  rememberSpeechMetadata(speech: {
    avatarEmotion?: string
    latencyMs?: string
    cache?: string
  }): void {
    this.lastAvatarEmotion = speech.avatarEmotion ?? 'none'
    this.lastTtsLatencyMs = speech.latencyMs ?? 'none'
    this.lastTtsCache = speech.cache ?? 'none'
  }

  async getSnapshot(): Promise<RuntimeDebugSnapshot> {
    const overlayState = await this.dependencies.getOverlayDebugState()
    const state = this.dependencies.getControllerState()
    const avatar = this.dependencies.getAvatarDebugState()
    const micGate = this.dependencies.getMicrophoneGateDebug()
    return {
      appStatus: state.status,
      continuousListening: state.continuousListening,
      backlogArbitration: this.dependencies.getBacklogDiagnostics(),
      avatarRuntimeHealth: this.dependencies.getAvatarRuntimeHealth(),
      characterState: this.dependencies.getCharacterState(),
      eventHistory: this.dependencies.getEventHistory(),
      avatarMode: avatar.mode,
      emotionKey: avatar.emotionKey,
      avatarEmotion: this.lastAvatarEmotion,
      currentBodyAnimation: avatar.currentBodyAnimation,
      currentBodyAnimationFile: avatar.currentBodyAnimationFile,
      currentBodyAnimationLoop: avatar.currentBodyAnimationLoop,
      currentBodyAnimationStatus: avatar.currentBodyAnimationStatus,
      bodyActions: avatar.bodyActions,
      model2d: avatar.model2d,
      previousBodyAnimation: avatar.previousBodyAnimation,
      activeTransitionPolicy: avatar.activeTransitionPolicy,
      activeBlendDuration: avatar.activeBlendDuration,
      animationQueue: avatar.animationQueue,
      speakingGestureScheduler: avatar.speakingGestureScheduler,
      behaviorEngine: avatar.behaviorEngine,
      currentBehaviorId: avatar.currentBehaviorId,
      currentBehaviorCandidates: avatar.currentBehaviorCandidates,
      behaviorSelectionReason: avatar.behaviorSelectionReason,
      activeAnimationCooldowns: avatar.activeAnimationCooldowns,
      selectedBehaviorAnimation: avatar.selectedBehaviorAnimation,
      currentGesture: avatar.currentGesture,
      idleOrchestrator: avatar.idleOrchestrator,
      lipsyncWeights: avatar.lipsyncWeights,
      facial: avatar.facial,
      lookAt: avatar.lookAt,
      headMotion: avatar.headMotion,
      earBehavior: avatar.earBehavior,
      tailBehavior: avatar.tailBehavior,
      performance: avatar.performance,
      playbackRequests: avatar.playbackRequests,
      speechTimeline: this.dependencies.getSpeechTimeline(),
      speechPolish: this.dependencies.getSpeechPolishDebugState(),
      behaviorTimeline: avatar.behaviorTimeline,
      ttsLatencyMs: this.lastTtsLatencyMs,
      ttsCache: this.lastTtsCache,
      overlayState,
      controllers: {
        avatar: this.dependencies.isAvatarLoaded() ? 'loaded' : 'not loaded',
        behavior: avatar.currentBehaviorId,
        behaviorIntent: avatar.behaviorEngine?.intent ?? 'none',
        selectedAnimation: avatar.selectedBehaviorAnimation,
        transitionPolicy: avatar.activeTransitionPolicy,
        blendDuration: `${avatar.activeBlendDuration}s`,
        transitionPending: avatar.playbackRequests.transitionPending ? 'yes' : 'no',
        ignoredDuplicateRequests: String(avatar.playbackRequests.ignoredDuplicateRequests),
        replayCount: String(avatar.playbackRequests.replayCount),
        bodyActions: String(avatar.bodyActions.activeActionCount),
        weightedBodyActions: String(avatar.bodyActions.weightedActionCount),
        lookAtMode: avatar.lookAt.mode,
        lookAtTarget: avatar.lookAt.target,
        headMotionProfile: avatar.headMotion.profile,
        headMotionEnergy: avatar.headMotion.motionEnergy.toFixed(3),
        lastLoadSource: avatar.bodyActions.lastLoadSource,
        lastLoadAnimation: avatar.bodyActions.lastLoadAnimationId ?? 'none',
        restartCount: String(avatar.bodyActions.restartCount),
        queueLength: String(avatar.animationQueue.length),
        speakingGestureSession: avatar.speakingGestureScheduler.active
          ? `#${avatar.speakingGestureScheduler.sessionId}`
          : 'inactive',
        speakingGesturePhase: avatar.speakingGestureScheduler.phase,
        animationFile: avatar.currentBodyAnimationFile,
        idleOrchestrator: avatar.idleOrchestrator.paused ? 'paused' : 'running',
        idleBehavior: avatar.idleBehavior,
        nextIdleBehaviorIn: `${avatar.nextIdleBehaviorIn}s`,
        ambientIdleBehavior: avatar.ambientIdleBehavior ? 'on' : 'off',
        animationFailures: avatar.animationFailures.length
          ? avatar.animationFailures.join(', ')
          : 'none',
        audio: this.dependencies.getPlaybackDebug().playing ? 'playing' : 'idle',
        microphone: state.status === 'listening' ? 'recording' : 'idle',
        faceTracking: state.faceTrackingEnabled ? 'on' : 'off',
        micGateStatus: micGate.gateStatus,
        micGatePendingIntent: micGate.pendingIntent
          ? micGate.pendingIntent.type === 'start-streaming'
            ? `start-streaming:${micGate.pendingIntent.modeId}`
            : 'start-voice-input'
          : 'none',
        micGateOpenReason: micGate.openReason ?? 'none',
        micGateSelectedDevice: micGate.selectedDeviceLabel ?? 'none',
        micGateLastValidation:
          micGate.lastValidationSucceeded === null
            ? 'none'
            : micGate.lastValidationSucceeded
              ? 'ok'
              : (micGate.lastFailureReason ?? 'failed'),
        micGateLastErrorName: micGate.lastNativeErrorName ?? 'none',
        micGateLastConstraint: micGate.lastConstraint ?? 'none',
      },
      timeline: this.timeline,
      runtimeHealth: this.invariantValidator.getHealth(),
    }
  }

  evaluateInvariants(input: { frame: number; now: number }): void {
    if (this.invariantValidator.isEnabled() && input.now - this.lastValidationAt >= 100) {
      this.lastValidationAt = input.now
      const character = this.dependencies.getCharacterState()
      const avatar = this.dependencies.getAvatarDebugState()
      const playback = this.dependencies.getPlaybackDebug()
      const facial = avatar.facial
      this.invariantValidator.evaluate({
        frame: input.frame,
        now: input.now,
        speechStatus: character.speechState.status,
        isSpeaking: character.speechState.status === 'speaking',
        characterMode: character.mode,
        avatarMode: avatar.mode,
        conversationResponsePhase: character.conversationPresence.responsePhase,
        playbackActive: playback.playing,
        activePlaybackId: playback.activePlaybackId,
        bodyActiveActionCount: avatar.bodyActions.activeActionCount,
        bodyWeightedActionCount: avatar.bodyActions.weightedActionCount,
        bodyTransitionRemaining: avatar.bodyActions.transitionRemaining,
        bodyOwnershipGapCount: avatar.bodyActions.ownershipGapCount,
        currentBodyAnimation: avatar.currentBodyAnimation,
        currentBehaviorId: avatar.currentBehaviorId,
        mouthMax: Math.max(
          facial.mouth.aa,
          facial.mouth.ih,
          facial.mouth.ou,
          facial.mouth.ee,
          facial.mouth.oh,
        ),
        facialActiveSources: facial.activeSources,
        facialEntrySources: facial.entries.map((entry) => entry.source),
        facialSupportedVisemes: facial.supportedVisemes,
        facialUnsupportedExpressionRequests: facial.unsupportedExpressionRequests,
        currentFacialProfile: facial.currentProfile,
        facialStuckWarnings: facial.stuckWarnings,
        lookAtTarget: avatar.lookAt.target,
        lookAtEyeYaw: avatar.lookAt.eyeYaw,
        lookAtEyePitch: avatar.lookAt.eyePitch,
        headMotionActiveGenerators: avatar.headMotion.activeGenerators,
        headMotionEnergy: avatar.headMotion.motionEnergy,
      })
    }

    this.transitionRecorder.observe(
      input.frame,
      this.dependencies.getAvatarDebugState(),
      this.invariantValidator.getHealth(),
    )
  }

  getHealth(): RuntimeHealth | null {
    return this.invariantValidator.getHealth()
  }
}
