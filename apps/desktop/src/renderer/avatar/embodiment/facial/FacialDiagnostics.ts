import { facialTuning } from '../../tuning/facialTuning'
import type { ExpressionSource, SourceLifecycleStatus } from './FacialDebugTypes'
import type { MouthWeights } from './FacialProfile'

export interface FacialLifecycleState {
  active: boolean
  lastUpdateFrame: number
  lastUpdateMs: number | null
  raw: Record<string, number>
  final: Record<string, number>
  status: SourceLifecycleStatus
  loggedStatus: SourceLifecycleStatus | null
  maxObservedValue: number
  stuckWarning: string | null
}

export class FacialDiagnostics {
  private blinkHighMs = 0
  private staleMouthHighMs = 0

  reset(): void {
    this.blinkHighMs = 0
    this.staleMouthHighMs = 0
  }

  updateStuckWarnings(
    lifecycle: Map<ExpressionSource, FacialLifecycleState>,
    blinkWeight: number,
    mouth: MouthWeights,
    deltaMs: number,
  ): void {
    const blinkState = lifecycle.get('autoBlink')
    const lipSyncState = lifecycle.get('lipSync')
    if (!blinkState || !lipSyncState) return

    this.blinkHighMs = blinkWeight > 0.8 ? this.blinkHighMs + deltaMs : 0
    blinkState.stuckWarning =
      this.blinkHighMs > 300 ? `blink > 0.8 for ${Math.round(this.blinkHighMs)}ms` : null

    const mouthMax = this.maxValue(mouth)
    const rawMax = this.maxValue(lipSyncState.raw)
    const staleOrSilent = lipSyncState.status !== 'active' || rawMax < 0.05
    this.staleMouthHighMs = mouthMax > 0.4 && staleOrSilent ? this.staleMouthHighMs + deltaMs : 0
    lipSyncState.stuckWarning =
      this.staleMouthHighMs > 500 ? `mouth > 0.4 while LipSync is ${lipSyncState.status}` : null
  }

  logLifecycleTransitions(
    lifecycle: Map<ExpressionSource, FacialLifecycleState>,
    frame: number,
    clockMs: number,
  ): void {
    const labels: Record<ExpressionSource, string> = {
      autoBlink: 'Blink',
      lipSync: 'LipSync',
      emotion: 'Emotion',
      lookAt: 'LookAt',
      speakingEye: 'SpeakingEye',
    }
    for (const [source, state] of lifecycle) {
      if (state.status === state.loggedStatus) continue
      const releaseProgress =
        state.status === 'decaying' || state.status === 'reset'
          ? 1 - Math.min(1, this.maxValue(state.final))
          : 0
      console.log(
        `[FACELIFE] source=${labels[source]} state=${state.status} frame=${frame} t=${Math.round(clockMs)}ms max=${this.maxValue(state.raw).toFixed(2)} release=${releaseProgress.toFixed(2)}`,
      )
      state.loggedStatus = state.status
    }
  }

  logFacialFrame(
    lifecycle: Map<ExpressionSource, FacialLifecycleState>,
    mouth: MouthWeights,
    blinkWeight: number,
    finalValues: Record<string, number>,
  ): void {
    if (!facialTuning.debug.verboseFacialFrameLogs) return
    const lip = lifecycle.get('lipSync')
    const blink = lifecycle.get('autoBlink')
    const emotion = lifecycle.get('emotion')
    if (!lip || !blink || !emotion) return
    if (this.maxValue(mouth) <= 0.001 && blinkWeight <= 0.001 && !lip.active) return

    const final = (name: string): string => (finalValues[name] ?? 0).toFixed(2)
    const emotionFinal = ['happy', 'sad', 'angry', 'surprised', 'relaxed']
      .map((name) => `${name}=${final(name)}`)
      .join(' ')
    console.log(
      `[FACEDBG] final blink=${final('blink')} blinkLeft=${final('blinkLeft')} blinkRight=${final('blinkRight')} aa=${final('aa')} ih=${final('ih')} ou=${final('ou')} ee=${final('ee')} oh=${final('oh')} ${emotionFinal} | sources AutoBlink=${this.maxValue(blink.raw).toFixed(2)}(${blink.status}) LipSync=aa:${(lip.raw.aa ?? 0).toFixed(2)}/ih:${(lip.raw.ih ?? 0).toFixed(2)}/ou:${(lip.raw.ou ?? 0).toFixed(2)}/ee:${(lip.raw.ee ?? 0).toFixed(2)}/oh:${(lip.raw.oh ?? 0).toFixed(2)}(${lip.status}) Emotion=${this.maxValue(emotion.raw).toFixed(2)}(${emotion.status})`,
    )
  }

  roundValues(values: Record<string, number>): Record<string, number> {
    return Object.fromEntries(
      Object.entries(values).map(([name, value]) => [name, Number(value.toFixed(2))]),
    )
  }

  roundMouthWeights(values: MouthWeights): MouthWeights {
    return {
      aa: Number(values.aa.toFixed(2)),
      ih: Number(values.ih.toFixed(2)),
      ou: Number(values.ou.toFixed(2)),
      ee: Number(values.ee.toFixed(2)),
      oh: Number(values.oh.toFixed(2)),
    }
  }

  private maxValue(values: Record<string, number>): number {
    return Object.values(values).reduce(
      (max, value) => Math.max(max, Math.max(0, Math.min(1, Number(value) || 0))),
      0,
    )
  }
}
