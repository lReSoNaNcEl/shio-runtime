import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomInt, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  DANCE_HORIZON_FRAMES,
  FLASH_MOTION_FORMAT,
  flashMotionReadySchema,
  getMotionProfile,
  MOTION_INFERENCE_DEADLINE_MS,
  MOTION_PHASE_IDS,
  type MotionActivity,
  type MotionChunk,
  type MotionLease,
  type MotionPlanIdentity,
  type MotionStatus,
  motionActivitySchema,
  motionChunkSchema,
  motionPlanIdentitySchema,
  motionSeedSchema,
} from '../../shared/motion'
import { FlashMotionSpeech } from './FlashMotionSpeech'

interface Pending {
  id: number
  frame: number
  maxFrames: number
  profileId: string
  seed: number
  plan: MotionPlanIdentity
  speech?: { playbackId: string; startSample: number; frames: number }
  resolve: (chunk: MotionChunk) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

/** Owns the single generated-motion process and its renderer lease. */
export class GeneratedMotionService {
  private process: ChildProcessWithoutNullStreams | null = null
  private state: MotionStatus['state'] = 'unavailable'
  private error: string | null = null
  private epoch = 0
  private modelGeneration = 0
  private lease: MotionLease | null = null
  private owner: number | null = null
  private pending: Pending | null = null
  private requestId = 0
  private lastGeneration: Promise<void> = Promise.resolve()
  private expectedFrame = 0
  private acceptedPlan: MotionPlanIdentity | null = null
  private acceptedProfile: string | null = null
  private retiredExecutions: string[] = []
  private startup: Promise<void> | null = null
  private stopping: Promise<void> | null = null
  private closed = false
  private settingEnabled = true
  private startingAvatar: number | null = null

  private assetHandle = ''
  constructor(
    private readonly root: string,
    private readonly currentAssetHandle: () => string = () => '',
    private readonly enabled = true,
    private readonly flashSpeech = new FlashMotionSpeech(),
    private readonly assets?: string,
  ) {}

  owns(owner: number, lease: MotionLease): boolean {
    return (
      owner === this.owner && this.matches(lease) && this.assetHandle === this.currentAssetHandle()
    )
  }

  status(): MotionStatus {
    return {
      state: this.state,
      error: this.error,
      epoch: this.epoch,
      modelGeneration: this.modelGeneration,
      session: this.lease ? { ...this.lease } : null,
      provider: 'flashmotion',
      weightsRevision: FLASH_MOTION_FORMAT.weightsRevision,
    }
  }

  warmup(): Promise<void> {
    if (!this.enabled || !this.settingEnabled) {
      this.error = 'MOTION_DISABLED'
      return Promise.reject(new Error(this.error))
    }
    if (this.startup) return this.startup
    if (this.process && this.state === 'ready') return Promise.resolve()
    this.startup = this.initialize().finally(() => {
      this.startup = null
    })
    return this.startup
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.settingEnabled = enabled
    if (!enabled) {
      if (this.process || this.startup || this.owner !== null || this.stopping)
        await this.stopProcess('MOTION_DISABLED')
      else if (!this.closed) this.error = 'MOTION_DISABLED'
      return
    }
    if (this.stopping) await this.stopping
    if (this.error === 'MOTION_DISABLED') this.error = null
  }

  private async initialize(): Promise<void> {
    if (this.closed) throw new Error('MOTION_CLOSED')
    if (this.stopping) await this.stopping
    if (this.closed) throw new Error('MOTION_CLOSED')
    if (!this.settingEnabled) throw new Error('MOTION_DISABLED')
    const interpreter = '/opt/shio-flashmotion/bin/python'
    const python =
      process.platform === 'win32'
        ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe')
        : interpreter
    if (!existsSync(python) || !existsSync(join(this.root, 'worker.py'))) {
      this.state = 'unavailable'
      this.error = 'MOTION_ASSETS_MISSING'
      throw new Error(this.error)
    }
    this.state = 'loading'
    this.error = null
    const environment: Record<string, string> = {
      PYTHONUTF8: '1',
      PYTHONUNBUFFERED: '1',
      HF_HUB_OFFLINE: '1',
      TRANSFORMERS_OFFLINE: '1',
    }
    const distribution = process.env.SHIO_FLASHMOTION_WSL_DISTRO || 'ShioFlashMotionV1'
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(distribution)) {
      this.state = 'unavailable'
      this.error = 'MOTION_ASSETS_MISSING'
      throw new Error(this.error)
    }
    if (this.assets) {
      environment.SHIO_FLASHMOTION_ASSETS = this.assets
      if (process.platform === 'win32') environment.WSLENV = 'SHIO_FLASHMOTION_ASSETS/p'
    }
    for (const key of [
      'PATH',
      'Path',
      'SystemRoot',
      'SYSTEMROOT',
      'USERPROFILE',
      'LOCALAPPDATA',
      'APPDATA',
      'COMSPEC',
      'PATHEXT',
      'CUDA_PATH',
    ]) {
      if (process.env[key]) environment[key] = process.env[key]
    }
    const args = [
      ...(process.platform === 'win32'
        ? ['--distribution', distribution, '--exec', interpreter]
        : []),
      '-B',
      '-u',
      'worker.py',
    ]
    const child = spawn(python, args, {
      cwd: this.root,
      env: environment,
      windowsHide: true,
      stdio: 'pipe',
    })
    this.process = child
    this.modelGeneration += 1
    let buffer = ''
    await new Promise<void>((resolve, reject) => {
      let started = false
      const deadline = setTimeout(() => {
        reject(new Error('MOTION_INIT_TIMEOUT'))
        void this.stopProcess('MOTION_INIT_TIMEOUT')
      }, 600_000)
      child.stdout.on('data', (data: Buffer) => {
        if (this.process !== child) return
        buffer += data.toString('utf8')
        if (Buffer.byteLength(buffer) > 524_288) {
          void this.stopProcess('MOTION_PROTOCOL_ERROR')
          return
        }
        while (buffer.includes('\n')) {
          const end = buffer.indexOf('\n'),
            line = buffer.slice(0, end)
          buffer = buffer.slice(end + 1)
          try {
            const value = JSON.parse(line) as Record<string, unknown>
            if (value.type === 'state' && value.status === 'warming') {
              this.state = 'warming'
              continue
            }
            if (value.type === 'ready' && !started) {
              if (!flashMotionReadySchema.safeParse(value).success)
                throw new Error('MOTION_PROVIDER_IDENTITY_MISMATCH')
              started = true
              clearTimeout(deadline)
              this.state = 'ready'
              resolve()
              continue
            }
            if (value.type === 'error') {
              const code = String(value.code)
              throw new Error(
                [
                  'MOTION_ASSETS_MISSING',
                  'MOTION_ASSET_HASH_MISMATCH',
                  'MOTION_OUT_OF_MEMORY',
                ].includes(code)
                  ? code
                  : 'MOTION_INFERENCE_FAILED',
              )
            }
            const chunk = motionChunkSchema.parse(value)
            if (!chunk.flashMotion) throw new Error('MOTION_PROVIDER_IDENTITY_MISMATCH')
            const pending = this.pending
            const speech = chunk.flashMotion?.speech
            if (
              !pending ||
              chunk.id !== pending.id ||
              chunk.profileId !== pending.profileId ||
              chunk.seed !== pending.seed ||
              chunk.avatarGeneration !== this.lease?.avatarGeneration ||
              JSON.stringify(chunk.plan) !== JSON.stringify(pending.plan) ||
              chunk.fromFrame !== pending.frame ||
              !this.matches(chunk) ||
              chunk.startFrame !== pending.frame ||
              chunk.rotations.length > pending.maxFrames ||
              (speech &&
                (!pending.speech ||
                  speech.playbackId !== pending.speech.playbackId ||
                  speech.startSample !== pending.speech.startSample ||
                  speech.frames > pending.speech.frames))
            )
              throw new Error('MOTION_STALE_OR_INVALID_CHUNK')
            if (speech && !this.flashSpeech.matches(speech.playbackId)) {
              this.rejectPending('MOTION_STALE_SPEECH_WINDOW')
              this.state = 'ready'
              continue
            }
            this.expectedFrame = chunk.startFrame + chunk.rotations.length
            clearTimeout(pending.timeout)
            this.pending = null
            this.state = 'ready'
            pending.resolve(chunk)
          } catch (error) {
            const code =
              error instanceof Error &&
              [
                'MOTION_INFERENCE_FAILED',
                'MOTION_STALE_OR_INVALID_CHUNK',
                'MOTION_PROVIDER_IDENTITY_MISMATCH',
                'MOTION_ASSETS_MISSING',
                'MOTION_ASSET_HASH_MISMATCH',
                'MOTION_OUT_OF_MEMORY',
              ].includes(error.message)
                ? error.message
                : 'MOTION_PROTOCOL_ERROR'
            if (!started) {
              clearTimeout(deadline)
              reject(new Error(code))
            }
            void this.stopProcess(code)
          }
        }
      })
      // Drain provider stderr without projecting model output or paths to renderer/debug.
      child.stderr.on('data', () => undefined)
      child.once('error', () => {
        clearTimeout(deadline)
        reject(new Error('MOTION_PROCESS_FAILED'))
        void this.stopProcess('MOTION_PROCESS_FAILED')
      })
      child.once('exit', () => {
        clearTimeout(deadline)
        if (!started) reject(new Error('MOTION_INIT_FAILED'))
        if (this.process === child) {
          this.process = null
          this.rejectPending('MOTION_PROCESS_EXITED')
          if (!this.stopping) {
            this.state = 'failed'
            this.error = 'MOTION_PROCESS_EXITED'
          }
        }
      })
    })
  }

  async start(owner: number, avatarGeneration: number, seed?: number): Promise<MotionLease> {
    if (this.owner !== null) throw new Error('MOTION_BUSY')
    this.owner = owner
    this.startingAvatar = avatarGeneration
    const reservation = this.epoch
    try {
      await this.warmup()
    } catch (error) {
      if (this.owner === owner && this.epoch === reservation) {
        this.owner = null
        this.startingAvatar = null
      }
      throw error
    }
    if (this.owner !== owner || this.epoch !== reservation || this.closed)
      throw new Error('MOTION_CANCELLED')
    this.startingAvatar = null
    this.assetHandle = this.currentAssetHandle()
    this.epoch += 1
    this.expectedFrame = 0
    this.acceptedPlan = null
    this.acceptedProfile = null
    this.retiredExecutions = []
    this.lease = {
      sessionId: randomUUID(),
      epoch: this.epoch,
      modelGeneration: this.modelGeneration,
      avatarGeneration,
      seed: seed ?? randomInt(0, 2_147_483_647),
    }
    return { ...this.lease }
  }

  async next(
    owner: number,
    lease: MotionLease,
    profileId: string,
    requestedFrame?: number,
    requestedPlan?: MotionPlanIdentity,
    requestedActivity?: MotionActivity,
  ): Promise<MotionChunk> {
    if (
      !this.owns(owner, lease) ||
      lease.seed !== this.lease?.seed ||
      lease.avatarGeneration !== this.lease?.avatarGeneration
    )
      throw new Error('MOTION_STALE_SESSION')
    const profile = getMotionProfile(profileId)
    const parsedPlan = motionPlanIdentitySchema.safeParse(requestedPlan)
    if (!profile || !parsedPlan.success) throw new Error('MOTION_INVALID_PLAN')
    const plan = parsedPlan.data
    if (profile.physicalAction && (plan.clockDomain !== 'local' || plan.phaseId !== 'prepare'))
      throw new Error('MOTION_INVALID_PLAN')
    const dance = profile.physicalAction?.action === 'dance-in-place'
    if (dance !== (plan.danceStyle !== undefined)) throw new Error('MOTION_INVALID_PLAN')
    const activity =
      requestedActivity === undefined ? undefined : motionActivitySchema.parse(requestedActivity)
    if (activity && plan.clockDomain === 'speech' && activity.playbackId !== plan.playbackId)
      throw new Error('MOTION_STALE_ACTIVITY')
    if (
      plan.handScoreRevision !== profile.handScore.revision ||
      plan.handRigCalibrationRevision !== profile.handScore.calibrationRevision
    )
      throw new Error('MOTION_INCOMPATIBLE_HAND_SCORE')
    const previous = this.acceptedPlan
    if (this.retiredExecutions.includes(plan.executionId)) throw new Error('MOTION_STALE_PLAN')
    if (previous) {
      const sameExecution = previous.executionId === plan.executionId
      if (
        previous.continuityAnchor !== plan.continuityAnchor ||
        (sameExecution &&
          (plan.planRevision < previous.planRevision ||
            plan.danceStyle !== previous.danceStyle ||
            MOTION_PHASE_IDS.indexOf(plan.phaseId) < MOTION_PHASE_IDS.indexOf(previous.phaseId) ||
            this.acceptedProfile !== profileId ||
            (plan.planRevision === previous.planRevision &&
              (plan.clockDomain !== previous.clockDomain ||
                plan.playbackId !== previous.playbackId)))) ||
        (!sameExecution && plan.phaseId !== 'prepare')
      )
        throw new Error('MOTION_STALE_PLAN')
    }
    if (this.pending) throw new Error('MOTION_BUSY')
    const child = this.process
    if (!child || this.state !== 'ready') throw new Error('MOTION_NOT_READY')
    const id = ++this.requestId
    const frame = requestedFrame ?? this.expectedFrame
    if (
      frame % 4 !== 0 ||
      frame < Math.max(0, this.expectedFrame - 120) ||
      frame > this.expectedFrame
    )
      throw new Error('MOTION_INVALID_REPLAN')
    if (previous && previous.executionId !== plan.executionId) {
      this.retiredExecutions.push(previous.executionId)
      if (this.retiredExecutions.length > 8) this.retiredExecutions.shift()
    }
    this.acceptedPlan = plan
    this.acceptedProfile = profileId
    this.state = 'generating'
    const speech =
      profile.kind === 'presence' &&
      activity?.speaking &&
      activity.sourceStartSample !== undefined &&
      plan.clockDomain === 'speech' &&
      plan.playbackId
        ? this.flashSpeech.window(plan.playbackId, activity.sourceStartSample)
        : undefined
    const requestedFrames = dance ? DANCE_HORIZON_FRAMES : profile.kind === 'presence' ? 24 : 60
    const generation = new Promise<MotionChunk>((resolve, reject) => {
      const timeout = setTimeout(() => {
        void this.stopProcess('MOTION_DEADLINE_MISS')
      }, MOTION_INFERENCE_DEADLINE_MS)
      this.pending = {
        id,
        frame,
        maxFrames: requestedFrames,
        profileId,
        seed: lease.seed,
        plan,
        speech,
        resolve,
        reject,
        timeout,
      }
      const request = {
        id,
        sessionId: lease.sessionId,
        epoch: lease.epoch,
        modelGeneration: lease.modelGeneration,
        avatarGeneration: lease.avatarGeneration,
        protocolVersion: 2,
        plan,
        profileId,
        seed: lease.seed,
        reset: frame === 0,
        fromFrame: frame,
        ...(activity ? { activity } : {}),
        ...(speech ? { speech } : {}),
        frames: requestedFrames,
      }
      child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (error) void this.stopProcess('MOTION_CHANNEL_FAILED')
      })
    })
    this.lastGeneration = generation.then(
      () => undefined,
      () => undefined,
    )
    return generation
  }

  async reroll(owner: number, lease: MotionLease, seed?: number): Promise<MotionLease> {
    await this.lastGeneration
    if (!this.owns(owner, lease) || !this.lease || lease.seed !== this.lease.seed)
      throw new Error('MOTION_STALE_SESSION')
    if (seed !== undefined && !motionSeedSchema.safeParse(seed).success)
      throw new Error('MOTION_INVALID_SEED')
    this.lease.seed = seed ?? randomInt(0, 2_147_483_647)
    return { ...this.lease }
  }

  private matches(value: Pick<MotionLease, 'sessionId' | 'epoch' | 'modelGeneration'>): boolean {
    return (
      value.sessionId === this.lease?.sessionId &&
      value.epoch === this.lease.epoch &&
      value.modelGeneration === this.lease.modelGeneration
    )
  }

  async stop(owner: number, lease: MotionLease | { avatarGeneration: number }): Promise<boolean> {
    if (owner !== this.owner) return false
    if (
      'sessionId' in lease
        ? !this.matches(lease)
        : this.startingAvatar !== lease.avatarGeneration &&
          this.lease?.avatarGeneration !== lease.avatarGeneration
    )
      return false
    await this.stopProcess('MOTION_CANCELLED')
    return true
  }

  async releaseOwner(owner: number): Promise<void> {
    if (owner === this.owner) await this.stopProcess('MOTION_CANCELLED')
  }

  private rejectPending(code: string): void {
    if (!this.pending) return
    clearTimeout(this.pending.timeout)
    this.pending.reject(new Error(code))
    this.pending = null
  }

  private stopProcess(code: string): Promise<void> {
    if (this.stopping) return this.stopping
    this.epoch += 1
    this.lease = null
    this.acceptedPlan = null
    this.acceptedProfile = null
    this.retiredExecutions = []
    this.owner = null
    this.startingAvatar = null
    this.state = 'stopping'
    this.error = code
    this.rejectPending(code)
    const child = this.process
    // Termination policy: only a confirmed exit of the exact process tree releases the GPU
    // lease. A failed or unconfirmed termination fails closed: `stopping` stays rejected, so
    // every warmup reports MOTION_TERMINATION_FAILED instead of starting a second worker.
    // A later confirmation of the same tree lifts that block.
    let blocked = false
    const stopping: Promise<void> = new Promise<void>((resolve, reject) => {
      if (!child || child.exitCode !== null) {
        resolve()
        return
      }
      const confirm = () => {
        clearTimeout(deadline)
        if (this.process === child) this.process = null
        if (!blocked) {
          resolve()
          return
        }
        if (this.stopping !== stopping) return
        this.stopping = null
        this.state = this.closed ? 'closed' : 'unavailable'
      }
      const fail = () => {
        clearTimeout(deadline)
        if (blocked) return
        blocked = true
        reject(new Error('MOTION_TERMINATION_FAILED'))
      }
      const deadline = setTimeout(fail, 5000)
      // The Linux worker watches stdin independently of inference and exits on EOF.
      child.once('exit', confirm)
      child.stdin.end()
    }).then(() => {
      this.stopping = null
      this.state = this.closed ? 'closed' : 'unavailable'
    })
    this.stopping = stopping
    // Every detached failure is contained and represented in owned state.
    void stopping.catch(() => {
      if (this.stopping !== stopping) return
      this.state = 'failed'
      this.error = 'MOTION_TERMINATION_FAILED'
    })
    return stopping
  }

  async dispose(): Promise<void> {
    this.closed = true
    await this.stopProcess('MOTION_CLOSED')
  }
}
