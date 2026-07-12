import { useEffect, useState } from 'react'
import { Button, ButtonGroup, Content, Dialog, DialogContainer, Divider, Heading, Switch } from '@react-spectrum/s2'
import { DEBUG_AVATAR_MODE_LABELS, DEBUG_AVATAR_MODES } from '../avatar/avatarAnimations'
import { controller, STATUS_LABELS } from '../Controller'
import type { RuntimeDebugSnapshot } from '../Controller'

interface Props {
  isOpen: boolean
  onClose: () => void
}

const DEBUG_TITLE = 'Отладка рантайма'
const FULL_TEST = 'Тест всего цикла'
const CLOSE = 'Закрыть'
const OVERLAY_ANIMATION_HUD = 'Показывать текущую анимацию Overlay'
const DEBUG_TABS = [
  { id: 'overview', label: 'Обзор' },
  { id: 'eventBus', label: 'Event Bus' },
  { id: 'timeline', label: 'Timeline' }
] as const

type DebugTabId = (typeof DEBUG_TABS)[number]['id']

const FACIAL_SOURCE_LABELS: Record<string, string> = {
  autoBlink: 'Auto Blink',
  lipSync: 'LipSync',
  emotion: 'Emotion Runtime',
  lookAt: 'LookAt',
  speakingEye: 'Speaking Eye'
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatWeight(value: number): string {
  return value.toFixed(2)
}

function formatRecord(values: Record<string, number>): string {
  const entries = Object.entries(values)
  if (entries.length === 0) return 'none'
  return entries.map(([key, value]) => `${key}:${formatWeight(value)}`).join(' ')
}

function formatMs(value: number): string {
  if (value <= 0) return 'ready'
  return `${(value / 1000).toFixed(1)}s`
}

function formatDeg(value: number): string {
  return `${((value * 180) / Math.PI).toFixed(1)}deg`
}

function formatPose(pose?: { lift: number; spread: number }): string {
  if (!pose) return '—'
  return `lift ${formatWeight(pose.lift)} / spread ${formatWeight(pose.spread)}`
}

function getCurrentEmotionWeight(snapshot: RuntimeDebugSnapshot): number {
  return Object.values(snapshot.facial.emotion).reduce((max, value) => Math.max(max, value), 0)
}

function getCurrentLipSyncWeight(snapshot: RuntimeDebugSnapshot): number {
  return Math.max(
    snapshot.lipsyncWeights.aa,
    snapshot.lipsyncWeights.ih,
    snapshot.lipsyncWeights.ou,
    snapshot.lipsyncWeights.ee,
    snapshot.lipsyncWeights.oh
  )
}

export function AvatarDebugDialog({ isOpen, onClose }: Props): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<RuntimeDebugSnapshot | null>(null)
  const [activeTab, setActiveTab] = useState<DebugTabId>('overview')
  const [overlayAnimationHudEnabled, setOverlayAnimationHudEnabled] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    let alive = true
    const refresh = (): void => {
      void controller.getRuntimeDebug().then((next) => {
        if (alive) setSnapshot(next)
      })
    }

    refresh()
    const timer = window.setInterval(refresh, 500)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    void window.api.config.get().then((cfg) => {
      setOverlayAnimationHudEnabled(cfg.overlayShowCurrentAnimation === 'true')
    })
  }, [isOpen])

  const updateOverlayAnimationHud = (enabled: boolean): void => {
    setOverlayAnimationHudEnabled(enabled)
    void window.api.config.save({ overlayShowCurrentAnimation: enabled ? 'true' : 'false' }).then(() => {
      void window.api.overlay.applySettings()
    })
  }

  return (
    <DialogContainer onDismiss={onClose}>
      {isOpen && (
        <Dialog size="L">
          <Heading>{DEBUG_TITLE}</Heading>
          <Divider />
          <Content>
            <div className="debug-tabs" role="tablist" aria-label="Разделы отладки">
              {DEBUG_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={activeTab === tab.id ? 'settings-tab active' : 'settings-tab'}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className={`debug-panel debug-tab-${activeTab}`}>
              {snapshot && (
                <>
                  <section className="debug-section">
                    <div className="debug-section-title">Снимок runtime</div>
                    <div className="debug-stat-grid">
                      <DebugStat label="status" value={STATUS_LABELS[snapshot.appStatus]} />
                      <DebugStat label="character mode" value={snapshot.characterState.mode} />
                      <DebugStat label="character speech" value={snapshot.characterState.speechState.status} />
                      <DebugStat label="character activity" value={snapshot.characterState.activity} />
                      <DebugStat label="character attention" value={snapshot.characterState.attention.focus} />
                      <DebugStat label="avatar mode" value={snapshot.avatarMode} />
                      <DebugStat label="emotionKey" value={snapshot.emotionKey} />
                      <DebugStat label="vrmEmotion" value={snapshot.vrmEmotion} />
                      <DebugStat label="body animation" value={snapshot.currentBodyAnimation} />
                      <DebugStat label="previous animation" value={snapshot.previousBodyAnimation} />
                      <DebugStat label="body animation file" value={snapshot.currentBodyAnimationFile} />
                      <DebugStat label="animation loops" value={snapshot.currentBodyAnimationLoop ? 'yes' : 'no'} />
                      <DebugStat label="playback status" value={snapshot.currentBodyAnimationStatus} />
                      <DebugStat label="transition policy" value={snapshot.activeTransitionPolicy} />
                      <DebugStat label="blend duration" value={`${snapshot.activeBlendDuration}s`} />
                      <DebugStat label="body actions" value={String(snapshot.bodyActions.activeActionCount)} />
                      <DebugStat label="weighted actions" value={String(snapshot.bodyActions.weightedActionCount)} />
                      <DebugStat label="transition remaining" value={`${snapshot.bodyActions.transitionRemaining.toFixed(2)}s`} />
                      <DebugStat label="root motion" value={snapshot.bodyActions.rootMotionPolicy} />
                      <DebugStat label="restart count" value={String(snapshot.bodyActions.restartCount)} />
                      <DebugStat label="ownership gaps" value={String(snapshot.bodyActions.ownershipGapCount)} />
                      <DebugStat label="queue length" value={String(snapshot.animationQueue.length)} />
                      <DebugStat label="next queued" value={snapshot.animationQueue.next?.animationId ?? 'none'} />
                      <DebugStat label="behavior intent" value={snapshot.behaviorEngine?.intent ?? 'none'} />
                      <DebugStat label="reply type" value={snapshot.behaviorEngine?.replyType ?? 'none'} />
                      <DebugStat label="behavior" value={snapshot.currentBehaviorId} />
                      <DebugStat label="selected animation" value={snapshot.selectedBehaviorAnimation} />
                      <DebugStat label="idle orchestrator" value={snapshot.idleOrchestrator.paused ? 'paused' : 'running'} />
                      <DebugStat label="idle stage" value={snapshot.idleOrchestrator.idleStage} />
                      <DebugStat label="idle state" value={snapshot.idleOrchestrator.currentIdleState} />
                      <DebugStat label="next idle" value={snapshot.idleOrchestrator.nextScheduledIdleAnimation} />
                      <DebugStat label="next idle in" value={`${snapshot.idleOrchestrator.nextTransitionIn}s`} />
                      <DebugStat label="idle presence duration" value={`${snapshot.idleOrchestrator.extendedIdleDuration}s`} />
                      <DebugStat label="current idle presence" value={snapshot.idleOrchestrator.currentExtendedIdleAnimation} />
                      <DebugStat label="next idle presence" value={snapshot.idleOrchestrator.nextExtendedIdleCandidate} />
                      <DebugStat label="gesture" value={snapshot.currentGesture} />
                      <DebugStat
                        label="speaking session"
                        value={snapshot.speakingGestureScheduler.active ? `#${snapshot.speakingGestureScheduler.sessionId}` : 'inactive'}
                      />
                      <DebugStat label="speaking gesture phase" value={snapshot.speakingGestureScheduler.phase} />
                      <DebugStat label="TTS latency" value={snapshot.ttsLatencyMs} />
                      <DebugStat label="TTS cache" value={snapshot.ttsCache} />
                      <DebugStat label="overlay" value={snapshot.overlayState} />
                    </div>
                  </section>

                  <section className="debug-section">
                    <div className="debug-section-title">Avatar Polish Summary</div>
                    <div className="debug-stat-grid">
                      <DebugStat label="FPS Avatar" value={String(snapshot.performance.avatarFps)} />
                      <DebugStat label="Current Emotion Weight" value={formatWeight(getCurrentEmotionWeight(snapshot))} />
                      <DebugStat label="Current LookAt Target" value={snapshot.lookAt.target} />
                      <DebugStat
                        label="Current Blink State"
                        value={`${snapshot.facial.blinkTuning.profileId} В· ${snapshot.facial.blinkTuning.phase} В· ${formatWeight(snapshot.facial.blinkTuning.weight)}`}
                      />
                      <DebugStat label="Current Facial Profile" value={snapshot.facial.currentProfile} />
                      <DebugStat label="Current LipSync Weight" value={formatWeight(getCurrentLipSyncWeight(snapshot))} />
                      <DebugStat label="Idle" value={`${snapshot.idleOrchestrator.idleStage} В· ${snapshot.idleOrchestrator.currentIdleState}`} />
                      <DebugStat label="Queue" value={`${snapshot.animationQueue.length} queued`} />
                      <DebugStat label="Cooldowns" value={String(snapshot.activeAnimationCooldowns.length)} />
                      <DebugStat label="Animation" value={`${snapshot.currentBodyAnimation} В· ${snapshot.currentBodyAnimationStatus}`} />
                    </div>
                  </section>

                  <section className="debug-section">
                    <div className="debug-section-title">Speaking Gesture Scheduler</div>
                    <div className="debug-stat-grid">
                      <DebugStat label="active" value={snapshot.speakingGestureScheduler.active ? 'yes' : 'no'} />
                      <DebugStat label="session id" value={String(snapshot.speakingGestureScheduler.sessionId)} />
                      <DebugStat label="elapsed" value={`${(snapshot.speakingGestureScheduler.elapsedMs / 1000).toFixed(1)}s`} />
                      <DebugStat label="phase" value={snapshot.speakingGestureScheduler.phase} />
                      <DebugStat label="current gesture" value={snapshot.speakingGestureScheduler.currentGesture} />
                      <DebugStat label="next behavior" value={snapshot.speakingGestureScheduler.nextBehavior} />
                      <DebugStat
                        label="next gesture in"
                        value={
                          snapshot.speakingGestureScheduler.active
                            ? `${(snapshot.speakingGestureScheduler.nextGestureInMs / 1000).toFixed(1)}s`
                            : 'none'
                        }
                      />
                      <DebugStat label="last animation" value={snapshot.speakingGestureScheduler.lastScheduledAnimation} />
                      <DebugStat
                        label="skipped candidates"
                        value={
                          snapshot.speakingGestureScheduler.skippedCandidates.length > 0
                            ? snapshot.speakingGestureScheduler.skippedCandidates.join(', ')
                            : 'none'
                        }
                      />
                      <DebugStat label="selection reason" value={snapshot.speakingGestureScheduler.selectionReason} />
                      <DebugStat label="decision" value={snapshot.speakingGestureScheduler.schedulerDecision} />
                    </div>
                  </section>

                  {snapshot.runtimeHealth && (
                    <section className="debug-section">
                      <div className="debug-section-title">
                        Runtime Health{' '}
                        {snapshot.runtimeHealth.failCount > 0 ? '✗ FAIL' : '✓ OK'}
                      </div>
                      <div className="debug-stat-grid">
                        <DebugStat label="enabled" value={snapshot.runtimeHealth.enabled ? 'yes' : 'no'} />
                        <DebugStat label="frame" value={String(snapshot.runtimeHealth.frame)} />
                        <DebugStat label="pass" value={String(snapshot.runtimeHealth.passCount)} />
                        <DebugStat label="fail" value={String(snapshot.runtimeHealth.failCount)} />
                        <DebugStat label="skip" value={String(snapshot.runtimeHealth.skipCount)} />
                        <DebugStat label="total violations" value={String(snapshot.runtimeHealth.totalViolations)} />
                        <DebugStat
                          label="last violation"
                          value={
                            snapshot.runtimeHealth.lastViolation
                              ? `${snapshot.runtimeHealth.lastViolation.id} @ ${formatTime(snapshot.runtimeHealth.lastViolation.at)} · ${snapshot.runtimeHealth.lastViolation.suspectedOwner}`
                              : 'none'
                          }
                        />
                      </div>
                      <div className="debug-controller-grid">
                        {snapshot.runtimeHealth.invariants.map((inv) => (
                          <DebugStat
                            key={inv.id}
                            label={`${inv.status === 'pass' ? '✓' : inv.status === 'fail' ? '✗' : '–'} ${inv.label}`}
                            value={`${inv.status}${inv.status !== 'pass' ? ` · ${inv.detail}` : ''}${inv.status === 'fail' ? ` · owner ${inv.suspectedOwner}` : ''}`}
                          />
                        ))}
                      </div>
                      <div className="debug-controller-grid">
                        {Object.entries(snapshot.runtimeHealth.subsystems).map(([key, value]) => (
                          <DebugStat key={key} label={key} value={value} />
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="debug-section">
                    <div className="debug-section-title">Character State</div>
                    <div className="debug-stat-grid">
                      <DebugStat label="mode" value={snapshot.characterState.mode} />
                      <DebugStat label="emotion" value={snapshot.characterState.emotion} />
                      <DebugStat label="activity" value={snapshot.characterState.activity} />
                      <DebugStat
                        label="attention"
                        value={`${snapshot.characterState.attention.focus} (${snapshot.characterState.attention.confidence})`}
                      />
                      <DebugStat label="speech.status" value={snapshot.characterState.speechState.status} />
                      <DebugStat label="speech.voiceId" value={snapshot.characterState.speechState.voiceId} />
                      <DebugStat label="speech.ttsGeneration" value={snapshot.characterState.speechState.ttsGeneration} />
                      <DebugStat label="animation.behavior" value={snapshot.characterState.animation.behavior} />
                      <DebugStat label="animation.id" value={snapshot.characterState.animation.animationId} />
                      <DebugStat label="voice.voiceId" value={snapshot.characterState.voice.voiceId} />
                      <DebugStat label="posture" value={snapshot.characterState.posture} />
                      <DebugStat label="conversation.phase" value={snapshot.characterState.conversation.conversationPhase} />
                    </div>
                    <pre className="debug-json">{JSON.stringify(snapshot.characterState, null, 2)}</pre>
                  </section>

                  <section className="debug-section">
                    <div className="debug-section-title">Conversation Presence</div>
                    <div className="debug-stat-grid">
                      <DebugStat label="phase" value={snapshot.characterState.conversationPresence.responsePhase} />
                      <DebugStat label="reply length" value={snapshot.characterState.conversationPresence.replyLength} />
                      <DebugStat label="engagement" value={snapshot.characterState.conversationPresence.engagement} />
                      <DebugStat label="hesitation" value={snapshot.characterState.conversationPresence.hesitation} />
                      <DebugStat label="reaction" value={snapshot.characterState.conversationPresence.reaction} />
                      <DebugStat label="emphasis" value={snapshot.characterState.conversationPresence.emphasis} />
                      <DebugStat label="pause hint" value={snapshot.characterState.conversationPresence.pauseHint} />
                      <DebugStat
                        label="last update"
                        value={
                          snapshot.characterState.conversationPresence.lastUpdate > 0
                            ? formatTime(snapshot.characterState.conversationPresence.lastUpdate)
                            : 'never'
                        }
                      />
                    </div>
                  </section>

                  <section className="debug-section">
                    <div className="debug-section-title">Playback Requests</div>
                    <div className="debug-controller-grid">
                      <DebugStat label="current animation" value={snapshot.playbackRequests.currentAnimation ?? 'none'} />
                      <DebugStat label="requested animation" value={snapshot.playbackRequests.requestedAnimation ?? 'none'} />
                      <DebugStat label="current transition" value={snapshot.playbackRequests.currentTransition} />
                      <DebugStat label="transition pending" value={snapshot.playbackRequests.transitionPending ? 'yes' : 'no'} />
                      <DebugStat label="replay count" value={String(snapshot.playbackRequests.replayCount)} />
                      <DebugStat
                        label="ignored duplicates"
                        value={String(snapshot.playbackRequests.ignoredDuplicateRequests)}
                      />
                    </div>
                    <div className="debug-timeline">
                      {snapshot.playbackRequests.requests.length === 0 && (
                        <div className="debug-empty">No playback requests yet</div>
                      )}
                      {snapshot.playbackRequests.requests
                        .slice()
                        .reverse()
                        .map((request) => (
                          <div key={request.id} className="debug-timeline-item">
                            <span className="debug-timeline-time">{String(request.frame)}</span>
                            <span className="debug-timeline-label">
                              {request.accepted ? 'accepted' : 'ignored'} {request.animationId}
                            </span>
                            <span className="debug-timeline-detail">
                              {request.source} В· {request.behaviorId} В· {request.rejectionReason ?? request.reason}
                            </span>
                          </div>
                        ))}
                    </div>
                  </section>

                  <section className="debug-section">
                    <div className="debug-section-title">Animation</div>
                    <div className="debug-controller-grid">
                      <DebugStat label="active action count" value={String(snapshot.bodyActions.activeActionCount)} />
                      <DebugStat label="weighted action count" value={String(snapshot.bodyActions.weightedActionCount)} />
                      <DebugStat label="current clip" value={snapshot.bodyActions.currentClipName ?? 'none'} />
                      <DebugStat label="last load animation" value={snapshot.bodyActions.lastLoadAnimationId ?? 'none'} />
                      <DebugStat label="last load file" value={snapshot.bodyActions.lastLoadFile ?? 'none'} />
                      <DebugStat label="last load source" value={snapshot.bodyActions.lastLoadSource} />
                      <DebugStat label="last load reason" value={snapshot.bodyActions.lastLoadReason} />
                      <DebugStat label="root motion policy" value={snapshot.bodyActions.rootMotionPolicy} />
                      <DebugStat label="hips delta Y" value={snapshot.bodyActions.hipsDeltaY.toFixed(3)} />
                      <DebugStat label="root delta Y" value={snapshot.bodyActions.rootDeltaY.toFixed(3)} />
                      <DebugStat label="max hips delta Y" value={snapshot.bodyActions.maxHipsDeltaY.toFixed(3)} />
                      <DebugStat label="max root delta Y" value={snapshot.bodyActions.maxRootDeltaY.toFixed(3)} />
                      <DebugStat label="restart count" value={String(snapshot.bodyActions.restartCount)} />
                      <DebugStat label="ownership gap count" value={String(snapshot.bodyActions.ownershipGapCount)} />
                      <DebugStat label="last transition event" value={snapshot.bodyActions.lastTransitionEvent} />
                      <DebugStat label="facial bone tracks stripped" value={String(snapshot.bodyActions.facialControlTracksDisabled)} />
                      <DebugStat
                        label="facial bone track names"
                        value={snapshot.bodyActions.facialControlTrackNames.length > 0 ? snapshot.bodyActions.facialControlTrackNames.join(', ') : 'none'}
                      />
                      <DebugStat
                        label="asset cache"
                        value={`fetch ${snapshot.animationAssetCache.fetches} · hit ${snapshot.animationAssetCache.hits} · miss ${snapshot.animationAssetCache.misses}`}
                      />
                      <DebugStat
                        label="clip cache"
                        value={`load ${snapshot.bodyActions.clipCache.loads} · reuse ${snapshot.bodyActions.clipCache.reuses} · hit ${snapshot.bodyActions.clipCache.hits} · miss ${snapshot.bodyActions.clipCache.misses} · parse ${snapshot.bodyActions.clipCache.parses}`}
                      />
                      <DebugStat
                        label="current clip time"
                        value={
                          snapshot.bodyActions.currentClipTime === null || snapshot.bodyActions.currentClipDuration === null
                            ? 'none'
                            : `${snapshot.bodyActions.currentClipTime.toFixed(2)} / ${snapshot.bodyActions.currentClipDuration.toFixed(2)}s`
                        }
                      />
                      <DebugStat label="transition remaining" value={`${snapshot.bodyActions.transitionRemaining.toFixed(2)}s`} />
                      {snapshot.bodyActions.actions.length === 0 && <DebugStat label="actions" value="none" />}
                      {snapshot.bodyActions.actions.map((action) => (
                        <DebugStat
                          key={`${action.name}-${action.time}-${action.current ? 'current' : action.previous ? 'previous' : 'old'}`}
                          label={`${action.current ? 'current ' : action.previous ? 'previous ' : ''}${action.name}`}
                          value={`w ${formatWeight(action.weight)} В· t ${action.time.toFixed(2)}/${action.duration.toFixed(2)} В· ${action.fadingOut ? 'fading out' : action.running ? 'running' : 'stopped'}`}
                        />
                      ))}
                    </div>
                  </section>

                  <section className="debug-section">
                    <div className="debug-section-title">Speech Presence</div>
                    <div className="debug-controller-grid">
                      <DebugStat label="speechEnergy" value={formatWeight(snapshot.facial.mouthTuning.speechEnergy)} />
                      <DebugStat
                        label="active visemes"
                        value={snapshot.facial.mouthTuning.activeVisemes.length > 0 ? snapshot.facial.mouthTuning.activeVisemes.join(', ') : 'none'}
                      />
                      <DebugStat label="viseme blend" value={formatRecord(snapshot.facial.mouthTuning.visemeBlend)} />
                      <DebugStat label="mouth openness" value={formatWeight(snapshot.facial.mouthTuning.openness)} />
                      <DebugStat label="release stage" value={snapshot.facial.mouthTuning.releaseStage} />
                      <DebugStat label="lookAt state" value={`${snapshot.lookAt.mode} / ${snapshot.lookAt.target}`} />
                      <DebugStat label="focus hold" value={formatMs(snapshot.lookAt.focusHoldMs)} />
                      <DebugStat label="current facial profile" value={snapshot.facial.currentProfile} />
                    </div>
                  </section>

                  <section className="debug-section">
                    <div className="debug-section-title">LipSync</div>
                    <div className="debug-weight-row">
                      <span>aa {formatWeight(snapshot.lipsyncWeights.aa)}</span>
                      <span>ih {formatWeight(snapshot.lipsyncWeights.ih)}</span>
                      <span>ou {formatWeight(snapshot.lipsyncWeights.ou)}</span>
                      <span>ee {formatWeight(snapshot.lipsyncWeights.ee)}</span>
                      <span>oh {formatWeight(snapshot.lipsyncWeights.oh)}</span>
                    </div>
                  </section>

                  <section className="debug-section">
                    <div className="debug-section-title">LookAt</div>
                    <div className="debug-controller-grid">
                      <DebugStat label="mode" value={snapshot.lookAt.mode} />
                      <DebugStat label="target" value={snapshot.lookAt.target} />
                      <DebugStat label="eye yaw" value={formatDeg(snapshot.lookAt.eyeYaw)} />
                      <DebugStat label="eye pitch" value={formatDeg(snapshot.lookAt.eyePitch)} />
                      <DebugStat label="next saccade" value={formatMs(snapshot.lookAt.nextSaccadeMs)} />
                      <DebugStat label="thinking timer" value={formatMs(snapshot.lookAt.thinkingTimerMs)} />
                      <DebugStat label="return progress" value={formatWeight(snapshot.lookAt.returnProgress)} />
                      <DebugStat label="focus hold" value={formatMs(snapshot.lookAt.focusHoldMs)} />
                      <DebugStat label="overshoot" value={formatMs(snapshot.lookAt.overshootMs)} />
                      <DebugStat
                        label="micro saccade"
                        value={`${formatDeg(snapshot.lookAt.microSaccade.yaw)} / ${formatDeg(snapshot.lookAt.microSaccade.pitch)}`}
                      />
                      <DebugStat label="head lag" value={formatMs(snapshot.lookAt.headLagMs)} />
                    </div>
                  </section>

                  <section className="debug-section">
                    <div className="debug-section-title">Performance</div>
                    <div className="debug-controller-grid">
                      <DebugStat label="FPS Avatar" value={String(snapshot.performance.avatarFps)} />
                      <DebugStat label="body actions" value={String(snapshot.bodyActions.activeActionCount)} />
                      <DebugStat label="weighted actions" value={String(snapshot.bodyActions.weightedActionCount)} />
                      <DebugStat label="runtime frame" value={snapshot.runtimeHealth ? String(snapshot.runtimeHealth.frame) : 'n/a'} />
                    </div>
                  </section>

                  <section className="debug-section">
                    <div className="debug-section-title">Head Motion</div>
                    <div className="debug-controller-grid">
                      <DebugStat label="profile" value={snapshot.headMotion.profile} />
                      <DebugStat
                        label="active generators"
                        value={snapshot.headMotion.activeGenerators.join(', ') || 'none'}
                      />
                      <DebugStat label="yaw offset" value={formatDeg(snapshot.headMotion.yawOffset)} />
                      <DebugStat label="pitch offset" value={formatDeg(snapshot.headMotion.pitchOffset)} />
                      <DebugStat label="roll offset" value={formatDeg(snapshot.headMotion.rollOffset)} />
                      <DebugStat label="motion energy" value={snapshot.headMotion.motionEnergy.toFixed(3)} />
                      <DebugStat label="current blend" value={formatWeight(snapshot.headMotion.currentBlend)} />
                      <DebugStat label="smoothing" value={String(snapshot.headMotion.smoothing)} />
                      <DebugStat label="next event" value={formatMs(snapshot.headMotion.nextProceduralEventMs)} />
                      <DebugStat
                        label="generator weights"
                        value={Object.entries(snapshot.headMotion.generatorWeights)
                          .map(([key, value]) => `${key}:${formatWeight(value)}`)
                          .join(' ')}
                      />
                    </div>
                  </section>

                  <section className="debug-section">
                    <div className="debug-section-title">Ear Runtime</div>
                    <div className="debug-controller-grid">
                      <DebugStat label="enabled" value={snapshot.earBehavior.enabled ? 'yes' : 'no'} />
                      <DebugStat label="bone status" value={snapshot.earBehavior.boneStatus} />
                      <DebugStat label="current profile" value={snapshot.earBehavior.profile} />
                      <DebugStat label="current emotion" value={snapshot.earBehavior.emotion} />
                      <DebugStat label="axis override" value={snapshot.earBehavior.axisOverride} />
                      <DebugStat label="amplitude scale" value={snapshot.earBehavior.amplitudeScale.toFixed(2)} />
                      <DebugStat label="update tick count" value={String(snapshot.earBehavior.updateTickCount)} />
                      <DebugStat label="last delta" value={`${snapshot.earBehavior.lastDeltaMs.toFixed(1)}ms`} />
                      <DebugStat label="idle timer" value={`${(snapshot.earBehavior.idleMs / 1000).toFixed(1)}s`} />
                      <DebugStat label="ear bone (L)" value={snapshot.earBehavior.left?.boneName ?? '—'} />
                      <DebugStat label="detected axis (L)" value={snapshot.earBehavior.left?.detectedAxis ?? '—'} />
                      <DebugStat label="current pose (L)" value={snapshot.earBehavior.left?.pose ?? '—'} />
                      <DebugStat label="rest pose (L)" value={snapshot.earBehavior.left?.restPose ?? '—'} />
                      <DebugStat label="base pose (L)" value={formatPose(snapshot.earBehavior.left?.basePose)} />
                      <DebugStat label="speaking modifier (L)" value={formatPose(snapshot.earBehavior.left?.speakingModifier)} />
                      <DebugStat label="final pose (L)" value={formatPose(snapshot.earBehavior.left?.finalPose)} />
                      <DebugStat
                        label="current rotation (L)"
                        value={snapshot.earBehavior.left ? formatDeg(snapshot.earBehavior.left.currentRotationRad) : '—'}
                      />
                      <DebugStat
                        label="target rotation (L)"
                        value={snapshot.earBehavior.left ? formatDeg(snapshot.earBehavior.left.targetRotationRad) : '—'}
                      />
                      <DebugStat label="ear bone (R)" value={snapshot.earBehavior.right?.boneName ?? '—'} />
                      <DebugStat label="detected axis (R)" value={snapshot.earBehavior.right?.detectedAxis ?? '—'} />
                      <DebugStat label="current pose (R)" value={snapshot.earBehavior.right?.pose ?? '—'} />
                      <DebugStat label="rest pose (R)" value={snapshot.earBehavior.right?.restPose ?? '—'} />
                      <DebugStat label="base pose (R)" value={formatPose(snapshot.earBehavior.right?.basePose)} />
                      <DebugStat label="speaking modifier (R)" value={formatPose(snapshot.earBehavior.right?.speakingModifier)} />
                      <DebugStat label="final pose (R)" value={formatPose(snapshot.earBehavior.right?.finalPose)} />
                      <DebugStat
                        label="current rotation (R)"
                        value={snapshot.earBehavior.right ? formatDeg(snapshot.earBehavior.right.currentRotationRad) : '—'}
                      />
                      <DebugStat
                        label="target rotation (R)"
                        value={snapshot.earBehavior.right ? formatDeg(snapshot.earBehavior.right.targetRotationRad) : '—'}
                      />
                      <DebugStat
                        label="random timer"
                        value={`L ${formatMs(snapshot.earBehavior.left?.nextEventMs ?? 0)} / R ${formatMs(snapshot.earBehavior.right?.nextEventMs ?? 0)}`}
                      />
                    </div>
                    <div className="settings-button-grid">
                      <Button variant="secondary" onPress={() => controller.setEarAxisOverride('auto')}>
                        Axis Auto
                      </Button>
                      <Button variant="secondary" onPress={() => controller.setEarAxisOverride('x')}>
                        Rotate X
                      </Button>
                      <Button variant="secondary" onPress={() => controller.setEarAxisOverride('y')}>
                        Rotate Y
                      </Button>
                      <Button variant="secondary" onPress={() => controller.setEarAxisOverride('z')}>
                        Rotate Z
                      </Button>
                      <Button
                        variant="secondary"
                        onPress={() => controller.setEarAmplitudeScale(Math.max(0, snapshot.earBehavior.amplitudeScale - 0.25))}
                      >
                        Amplitude −
                      </Button>
                      <Button
                        variant="secondary"
                        onPress={() => controller.setEarAmplitudeScale(snapshot.earBehavior.amplitudeScale + 0.25)}
                      >
                        Amplitude +
                      </Button>
                      <Button variant="secondary" onPress={() => controller.setEarAmplitudeScale(1)}>
                        Amplitude Reset
                      </Button>
                    </div>
                  </section>

                  <section className="debug-section">
                    <div className="debug-section-title">Current Facial State (Expression Mixer)</div>
                    <div className="debug-controller-grid">
                      <DebugStat
                        label="active sources"
                        value={
                          snapshot.facial.activeSources
                            .map((source) => FACIAL_SOURCE_LABELS[source] ?? source)
                            .join(', ') || 'none'
                        }
                      />
                      <DebugStat label="facial profile" value={snapshot.facial.currentProfile} />
                      <DebugStat label="expression blend" value={formatRecord(snapshot.facial.expressionBlend)} />
                      <DebugStat label="release curve" value={snapshot.facial.releaseCurve} />
                      <DebugStat
                        label="supported visemes"
                        value={snapshot.facial.supportedVisemes.length > 0 ? snapshot.facial.supportedVisemes.join(', ') : 'none'}
                      />
                      <DebugStat
                        label="supported expressions"
                        value={
                          snapshot.facial.supportedExpressions.length > 0
                            ? snapshot.facial.supportedExpressions.join(', ')
                            : 'none'
                        }
                      />
                      <DebugStat
                        label="unsupported requests"
                        value={
                          snapshot.facial.unsupportedExpressionRequests.length > 0
                            ? snapshot.facial.unsupportedExpressionRequests.join(', ')
                            : 'none'
                        }
                      />
                      <DebugStat label="blink" value={`${formatWeight(snapshot.facial.blink)} · Auto Blink`} />
                      <DebugStat
                        label="mouth (LipSync)"
                        value={`aa ${formatWeight(snapshot.facial.mouth.aa)} · ih ${formatWeight(snapshot.facial.mouth.ih)} · ou ${formatWeight(snapshot.facial.mouth.ou)} · ee ${formatWeight(snapshot.facial.mouth.ee)} · oh ${formatWeight(snapshot.facial.mouth.oh)}`}
                      />
                      <DebugStat
                        label="eye profile"
                        value={`contact ${formatWeight(snapshot.facial.eyeProfile.eyeContactBias)} · openness ${formatWeight(snapshot.facial.eyeProfile.eyeOpenness)} · lookAway ${formatWeight(snapshot.facial.eyeProfile.lookAwayBias)}`}
                      />
                      <DebugStat
                        label="mouth profile"
                        value={`gain ${formatWeight(snapshot.facial.mouthProfile.gainScale)} · open ${formatWeight(snapshot.facial.mouthProfile.opennessScale)} · softness ${formatWeight(snapshot.facial.mouthProfile.softness)} · bias ${formatWeight(snapshot.facial.mouthProfile.closedMouthBias)}`}
                      />
                      <DebugStat label="mouth openness" value={formatWeight(snapshot.facial.mouthTuning.openness)} />
                      <DebugStat label="speech energy" value={formatWeight(snapshot.facial.mouthTuning.speechEnergy)} />
                      <DebugStat
                        label="active visemes"
                        value={snapshot.facial.mouthTuning.activeVisemes.length > 0 ? snapshot.facial.mouthTuning.activeVisemes.join(', ') : 'none'}
                      />
                      <DebugStat label="viseme blend" value={formatRecord(snapshot.facial.mouthTuning.visemeBlend)} />
                      <DebugStat label="release stage" value={snapshot.facial.mouthTuning.releaseStage} />
                      <DebugStat
                        label="mouth runtime"
                        value={`${snapshot.facial.mouthTuning.attached ? 'attached' : 'detached'} В· envelope ${snapshot.facial.mouthTuning.envelope.toFixed(3)} В· weight ${formatWeight(snapshot.facial.mouthTuning.openness)}`}
                      />
                      <DebugStat
                        label="mouth telemetry"
                        value={`raw ${formatRecord(snapshot.facial.mouthTuning.raw)} В· filtered ${formatRecord(snapshot.facial.mouthTuning.filtered)} В· clamped ${formatRecord(snapshot.facial.mouthTuning.clamped)} В· final ${formatRecord(snapshot.facial.mouthTuning.final)}`}
                      />
                      <DebugStat
                        label="mouth signal stages"
                        value={`silence ${formatRecord(snapshot.facial.mouthTuning.afterSilenceThreshold)} В· attack/release ${formatRecord(snapshot.facial.mouthTuning.afterAttackRelease)} В· bias ${formatRecord(snapshot.facial.mouthTuning.afterMouthClosedBias)} В· clamp ${formatRecord(snapshot.facial.mouthTuning.afterClamp)}`}
                      />
                      <DebugStat
                        label="mouth signal warning"
                        value={snapshot.facial.mouthTuning.signalWarning ?? 'none'}
                      />
                      <DebugStat
                        label="mouth closed bias"
                        value={`${formatWeight(snapshot.facial.mouthTuning.mouthClosedBias)} В· silence ${snapshot.facial.mouthTuning.silenceThreshold}`}
                      />
                      <DebugStat
                        label="mouth clamps"
                        value={`aa ${formatWeight(snapshot.facial.mouthTuning.clamps.aa)} В· ih ${formatWeight(snapshot.facial.mouthTuning.clamps.ih)} В· ou ${formatWeight(snapshot.facial.mouthTuning.clamps.ou)} В· ee ${formatWeight(snapshot.facial.mouthTuning.clamps.ee)} В· oh ${formatWeight(snapshot.facial.mouthTuning.clamps.oh)}`}
                      />
                      <DebugStat
                        label="mouth attack/release"
                        value={`attack ${snapshot.facial.mouthTuning.attackPerSecond}/s В· release ${snapshot.facial.mouthTuning.releasePerSecond}/s В· silence ${snapshot.facial.mouthTuning.silentReleasePerSecond}/s В· detach ${snapshot.facial.mouthTuning.detachedReleasePerSecond}/s`}
                      />
                      <DebugStat
                        label="mouth live stats"
                        value={`#${snapshot.facial.mouthTuning.stats.playbackSeq} avg ${formatWeight(snapshot.facial.mouthTuning.stats.averageOpenness)} В· peak ${formatWeight(snapshot.facial.mouthTuning.stats.peakOpenness)} В· >70 ${snapshot.facial.mouthTuning.stats.percentHighOpen.toFixed(0)}% В· <15 ${snapshot.facial.mouthTuning.stats.percentClosed.toFixed(0)}%`}
                      />
                      <DebugStat
                        label="mouth open/release"
                        value={`longest >40 ${snapshot.facial.mouthTuning.stats.longestOpenMs.toFixed(0)}ms В· release ${
                          snapshot.facial.mouthTuning.stats.releaseAfterDetachMs === null
                            ? 'pending'
                            : `${snapshot.facial.mouthTuning.stats.releaseAfterDetachMs.toFixed(0)}ms`
                        } В· saturated ${snapshot.facial.mouthTuning.stats.saturatedSignal ? 'yes' : 'no'}`}
                      />
                      <DebugStat
                        label="blink tuning"
                        value={`${snapshot.facial.blinkTuning.phase} В· weight ${formatWeight(snapshot.facial.blinkTuning.weight)} В· range ${formatWeight(snapshot.facial.blinkTuning.weightMin)}-${formatWeight(snapshot.facial.blinkTuning.weightMax)} В· duration ${snapshot.facial.blinkTuning.duration}s`}
                      />
                      <DebugStat
                        label="blink profile"
                        value={`configured ${snapshot.facial.blinkTuning.configuredProfile.profileId} В· active ${snapshot.facial.blinkTuning.activeProfileSnapshot?.profileId ?? 'idle'} В· ${snapshot.facial.blinkTuning.source}`}
                      />
                      <DebugStat
                        label="blink sequence"
                        value={`${snapshot.facial.blinkTuning.triggerReason} В· ${snapshot.facial.blinkTuning.sequenceState} В· blinks ${snapshot.facial.blinkTuning.blinkCount} (double ${snapshot.facial.blinkTuning.doubleBlinkCount})`}
                      />
                      <DebugStat
                        label="blink raw/final"
                        value={`raw ${formatWeight(snapshot.facial.blinkTuning.rawWeight)} В· final ${formatWeight(snapshot.facial.blinkTuning.finalWeight)} В· clamp ${formatWeight(snapshot.facial.blinkTuning.blinkMax)}`}
                      />
                      <DebugStat
                        label="blink schedule"
                        value={`next ${snapshot.facial.blinkTuning.nextBlinkIn}s В· cooldown ${snapshot.facial.blinkTuning.cooldownRemaining}/${snapshot.facial.blinkTuning.cooldown}s`}
                      />
                      <DebugStat
                        label="blink expressions"
                        value={snapshot.facial.blinkExpressions.join(', ') || 'none'}
                      />
                      <DebugStat
                        label="VRMA facial tracks"
                        value={
                          snapshot.facial.vrmaFacialTracksDisabled > 0
                            ? `${snapshot.facial.vrmaFacialTracksDisabled} disabled`
                            : 'none detected'
                        }
                      />
                      <DebugStat
                        label="stuck warnings"
                        value={snapshot.facial.stuckWarnings.length > 0 ? snapshot.facial.stuckWarnings.join(' | ') : 'none'}
                      />
                    </div>
                    <div className="debug-section-title">Speaking Micro-Expressions</div>
                    <div className="debug-controller-grid">
                      <DebugStat
                        label="Speaking Eye Enabled"
                        value={`${snapshot.facial.speakingEye.enabled ? 'on' : 'off'} · ${
                          snapshot.facial.speakingEye.speaking ? 'speaking' : 'idle'
                        } · ${snapshot.facial.speakingEye.emotion}`}
                      />
                      <DebugStat
                        label="Eye Target Openness"
                        value={`L ${formatWeight(snapshot.facial.speakingEye.targetLeft)} · R ${formatWeight(
                          snapshot.facial.speakingEye.targetRight
                        )}`}
                      />
                      <DebugStat
                        label="Eye Current Openness"
                        value={`L ${formatWeight(snapshot.facial.speakingEye.currentLeft)} · R ${formatWeight(
                          snapshot.facial.speakingEye.currentRight
                        )}`}
                      />
                      <DebugStat
                        label="Left / Right Eye Offset"
                        value={`${formatWeight(snapshot.facial.speakingEye.leftOffset)} / ${formatWeight(
                          snapshot.facial.speakingEye.rightOffset
                        )} · ${snapshot.facial.speakingEye.leftExpression}/${snapshot.facial.speakingEye.rightExpression}`}
                      />
                      <DebugStat
                        label="Next Eye Variation Timer"
                        value={`${snapshot.facial.speakingEye.nextVariationMs}ms`}
                      />
                      <DebugStat
                        label="Mouth Closure Enabled"
                        value={`${snapshot.facial.mouthClosure.enabled ? 'on' : 'off'}${
                          snapshot.facial.mouthClosure.boundary ? ' · boundary' : ''
                        }`}
                      />
                      <DebugStat
                        label="Closure Active"
                        value={snapshot.facial.mouthClosure.active ? 'yes' : 'no'}
                      />
                      <DebugStat
                        label="Closure Strength"
                        value={formatWeight(snapshot.facial.mouthClosure.strength)}
                      />
                      <DebugStat
                        label="Closure Timer"
                        value={`since ${snapshot.facial.mouthClosure.sinceLastClosureMs}ms · next ${snapshot.facial.mouthClosure.nextClosureInMs}ms · grace ${snapshot.facial.mouthClosure.graceRemainingMs}ms`}
                      />
                      <DebugStat
                        label="Mouth Raw / Final Value"
                        value={`${formatWeight(snapshot.facial.mouthClosure.rawMouthMax)} → ${formatWeight(
                          snapshot.facial.mouthClosure.finalMouthMax
                        )}`}
                      />
                    </div>
                    <div className="debug-controller-grid">
                      {snapshot.facial.sourceLifecycle.map((source) => (
                        <DebugStat
                          key={source.source}
                          label={`${FACIAL_SOURCE_LABELS[source.source] ?? source.source} lifecycle`}
                          value={`${source.status}${source.active ? ' active' : ' inactive'} · last ${
                            source.lastUpdateMs === null ? 'never' : `${source.lastUpdateMs}ms`
                          } · raw ${formatRecord(source.raw)} · final ${formatRecord(source.final)} · max ${formatWeight(
                            source.maxObservedValue
                          )}${source.stuckWarning ? ` · WARN ${source.stuckWarning}` : ''}`}
                        />
                      ))}
                    </div>
                    <div className="debug-controller-grid">
                      {snapshot.facial.entries.length === 0 && (
                        <DebugStat label="final mixed output" value="neutral (all zero)" />
                      )}
                      {snapshot.facial.entries.map((entry) => (
                        <DebugStat
                          key={entry.expression}
                          label={entry.expression}
                          value={`${formatWeight(entry.value)} · ${FACIAL_SOURCE_LABELS[entry.source] ?? entry.source}`}
                        />
                      ))}
                    </div>
                  </section>

                  <section className="debug-section">
                    <div className="debug-section-title">speech timeline</div>
                    <div className="debug-controller-grid">
                      {snapshot.speechTimeline.length === 0 && <DebugStat label="speech states" value="none" />}
                      {snapshot.speechTimeline.slice(-8).map((entry) => (
                        <DebugStat
                          key={`${entry.at}-${entry.from}-${entry.to}`}
                          label={formatTime(entry.at)}
                          value={`${entry.from} -> ${entry.to} В· mode ${entry.mode} В· ${entry.durationMs === null ? 'first' : `${entry.durationMs}ms`} В· ${entry.emotion}`}
                        />
                      ))}
                    </div>
                  </section>

                  <section className="debug-section">
                    <div className="debug-section-title">behavior timeline</div>
                    <div className="debug-controller-grid">
                      {snapshot.behaviorTimeline.length === 0 && <DebugStat label="behavior transitions" value="none" />}
                      {snapshot.behaviorTimeline.slice(-8).map((entry) => (
                        <DebugStat
                          key={`${entry.at}-${entry.frame}-${entry.toAnimationId}`}
                          label={`${formatTime(entry.at)} f${entry.frame}`}
                          value={`${entry.fromBehaviorId} -> ${entry.toBehaviorId} В· ${entry.fromAnimationId ?? 'none'} -> ${entry.toAnimationId} В· ${entry.accepted ? 'accepted' : 'held'} В· ${entry.source}`}
                        />
                      ))}
                    </div>
                  </section>

                  <section className="debug-section">
                    <div className="debug-section-title">controllers</div>
                    <div className="debug-controller-grid">
                      {Object.entries(snapshot.controllers).map(([key, value]) => (
                        <DebugStat key={key} label={key} value={value} />
                      ))}
                    </div>
                  </section>

                  <section className="debug-section debug-tab-panel debug-tab-timeline-panel">
                    <div className="debug-section-title">timeline</div>
                    <div className="debug-timeline">
                      {snapshot.timeline.length === 0 && <div className="debug-empty">No runtime events yet</div>}
                      {snapshot.timeline
                        .slice()
                        .reverse()
                        .map((event) => (
                          <div key={event.id} className="debug-timeline-item">
                            <span className="debug-timeline-time">{formatTime(event.at)}</span>
                            <span className="debug-timeline-label">{event.label}</span>
                            {event.detail && <span className="debug-timeline-detail">{event.detail}</span>}
                          </div>
                        ))}
                    </div>
                  </section>

                  <section className="debug-section debug-tab-panel debug-tab-eventBus-panel">
                    <div className="debug-section-title">event bus</div>
                    <div className="debug-timeline">
                      {snapshot.eventHistory.length === 0 && <div className="debug-empty">No runtime events yet</div>}
                      {snapshot.eventHistory
                        .slice()
                        .reverse()
                        .map((event) => (
                          <div key={event.id} className="debug-timeline-item">
                            <span className="debug-timeline-time">{formatTime(event.occurredAt)}</span>
                            <span className="debug-timeline-label">{event.type}</span>
                            <span className="debug-timeline-detail">{event.category}</span>
                            {event.detail && <span className="debug-timeline-detail">{event.detail}</span>}
                          </div>
                        ))}
                    </div>
                  </section>
                </>
              )}

              <section className="debug-section">
                <div className="debug-section-title">Overlay</div>
                <Switch isSelected={overlayAnimationHudEnabled} onChange={updateOverlayAnimationHud}>
                  {OVERLAY_ANIMATION_HUD}
                </Switch>
              </section>

              <section className="debug-section">
                <div className="debug-section-title">Полный тест</div>
                <Button variant="accent" onPress={() => controller.runDebugFullRuntimeTest('happy')}>
                  {FULL_TEST}
                </Button>
              </section>

              <section className="debug-section">
                <div className="debug-section-title">Тест режимов аватара</div>
                <div className="settings-button-grid">
                  {DEBUG_AVATAR_MODES.map((mode) => (
                    <Button key={mode} variant="secondary" onPress={() => controller.previewAvatarMode(mode)}>
                      {mode} ({DEBUG_AVATAR_MODE_LABELS[mode]})
                    </Button>
                  ))}
                  <Button variant="secondary" onPress={() => controller.previewAvatarGreeting()}>
                    greeting (приветствие)
                  </Button>
                  <Button variant="secondary" onPress={() => controller.previewAvatarBlink()}>
                    blink test (моргание)
                  </Button>
                  <Button variant="secondary" onPress={() => controller.rerollAvatarAnimation()}>
                    Re-roll Animation
                  </Button>
                  <Button variant="secondary" onPress={() => controller.clearAvatarAnimationCooldowns()}>
                    Clear Cooldowns
                  </Button>
                  <Button variant="secondary" onPress={() => controller.clearAvatarAnimationQueue()}>
                    Clear Queue
                  </Button>
                  <Button variant="secondary" onPress={() => controller.queueAvatarTestSequence()}>
                    Queue Test Sequence
                  </Button>
                  <Button
                    variant="secondary"
                    onPress={() => controller.setIdleOrchestratorPaused(!snapshot?.idleOrchestrator.paused)}
                  >
                    {snapshot?.idleOrchestrator.paused ? 'Resume Idle Orchestrator' : 'Pause Idle Orchestrator'}
                  </Button>
                </div>
              </section>

              {snapshot && (
                <section className="debug-section">
                  <div className="debug-section-title">behavior candidates</div>
                  <div className="debug-controller-grid">
                    {snapshot.currentBehaviorCandidates.length === 0 && (
                      <DebugStat label="candidates" value="none" />
                    )}
                    {snapshot.currentBehaviorCandidates.map((candidate) => (
                      <DebugStat
                        key={candidate.animationId}
                        label={`${candidate.selected ? '▶ ' : ''}${candidate.animationId}`}
                        value={`weight ${candidate.weight}${candidate.selectionShare > 0 ? ` · ${Math.round(candidate.selectionShare * 100)}%` : ''} · cooldown ${formatMs(candidate.cooldownRemainingMs)}${candidate.excludedByCooldown ? ' · cooldown excluded' : ''}${candidate.excludedByUsage ? ' · usage excluded' : ''}`}
                      />
                    ))}
                  </div>
                </section>
              )}

              {snapshot && (
                <section className="debug-section">
                  <div className="debug-section-title">behavior decision</div>
                  <div className="debug-controller-grid">
                    <DebugStat label="intent" value={snapshot.behaviorEngine?.intent ?? 'none'} />
                    <DebugStat label="context" value={snapshot.behaviorEngine?.contextSummary ?? 'none'} />
                    <DebugStat
                      label="candidate behaviors"
                      value={snapshot.behaviorEngine?.candidateBehaviors.join(', ') ?? 'none'}
                    />
                    <DebugStat label="selected behavior" value={snapshot.currentBehaviorId} />
                    <DebugStat label="selected animation" value={snapshot.selectedBehaviorAnimation} />
                    <DebugStat label="why this animation" value={snapshot.behaviorSelectionReason} />
                  </div>
                  <div className="debug-timeline">
                    {snapshot.behaviorEngine?.pipeline.map((step, index) => (
                      <div key={`${index}-${step}`} className="debug-timeline-item">
                        <span className="debug-timeline-time">{String(index + 1).padStart(2, '0')}</span>
                        <span className="debug-timeline-label">{step}</span>
                      </div>
                    )) ?? <div className="debug-empty">No behavior decision yet</div>}
                  </div>
                </section>
              )}

              <section className="debug-section">
                <div className="debug-section-title">transition tests</div>
                <div className="settings-button-grid">
                  <Button variant="secondary" onPress={() => controller.testAvatarTransition('idle-to-idle')}>
                    Idle to Idle
                  </Button>
                  <Button variant="secondary" onPress={() => controller.testAvatarTransition('idle-to-speaking')}>
                    Idle to Speaking
                  </Button>
                  <Button variant="secondary" onPress={() => controller.testAvatarTransition('speaking-to-idle')}>
                    Speaking to Idle
                  </Button>
                  <Button variant="secondary" onPress={() => controller.testAvatarTransition('thinking-to-idle')}>
                    Thinking to Idle
                  </Button>
                  <Button variant="secondary" onPress={() => controller.testAvatarTransition('greeting-to-idle')}>
                    Greeting to Idle
                  </Button>
                </div>
              </section>

              {snapshot && (
                <section className="debug-section">
                  <div className="debug-section-title">active cooldowns</div>
                  <div className="debug-controller-grid">
                    {snapshot.activeAnimationCooldowns.length === 0 && (
                      <DebugStat label="cooldowns" value="none" />
                    )}
                    {snapshot.activeAnimationCooldowns.map((cooldown) => (
                      <DebugStat
                        key={cooldown.animationId}
                        label={cooldown.animationId}
                        value={`${formatMs(cooldown.remainingMs)} / ${(cooldown.cooldownMs / 1000).toFixed(1)}s`}
                      />
                    ))}
                  </div>
                </section>
              )}

              {snapshot && (
                <section className="debug-section">
                  <div className="debug-section-title">animation queue</div>
                  <div className="debug-controller-grid">
                    <DebugStat
                      label="currently playing"
                      value={snapshot.animationQueue.current?.animationId ?? snapshot.currentBodyAnimation}
                    />
                    <DebugStat label="next queued" value={snapshot.animationQueue.next?.animationId ?? 'none'} />
                    <DebugStat label="queue length" value={String(snapshot.animationQueue.length)} />
                    {snapshot.animationQueue.items.length === 0 && <DebugStat label="queued items" value="none" />}
                    {snapshot.animationQueue.items.map((item) => (
                      <DebugStat
                        key={item.id}
                        label={`${item.id}: ${item.animationId}`}
                        value={`${item.mode}, ${item.behaviorId}, ${item.interruptible ? 'interruptible' : 'locked'}`}
                      />
                    ))}
                  </div>
                </section>
              )}

              {snapshot && (
                <section className="debug-section">
                  <div className="debug-section-title">idle timeline</div>
                  <div className="debug-timeline">
                    {snapshot.idleOrchestrator.timeline.length === 0 && (
                      <div className="debug-empty">No idle transitions yet</div>
                    )}
                    {snapshot.idleOrchestrator.timeline
                      .slice()
                      .reverse()
                      .map((event) => (
                        <div key={event.id} className="debug-timeline-item">
                          <span className="debug-timeline-time">{formatTime(event.at)}</span>
                          <span className="debug-timeline-label">{event.animationId}</span>
                        </div>
                      ))}
                  </div>
                </section>
              )}
            </div>
          </Content>
          <ButtonGroup>
            <Button variant="secondary" onPress={onClose}>
              {CLOSE}
            </Button>
          </ButtonGroup>
        </Dialog>
      )}
    </DialogContainer>
  )
}

function DebugStat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="debug-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
