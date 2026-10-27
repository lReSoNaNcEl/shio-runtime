import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomInt, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  getMotionProfile,
  MOTION_INFERENCE_DEADLINE_MS,
  MOTION_PHASE_IDS,
  type MotionChunk,
  type MotionLease,
  type MotionPlanIdentity,
  type MotionStatus,
  motionChunkSchema,
  motionPlanIdentitySchema,
  motionReadySchema,
  motionSeedSchema,
} from '../../shared/motion'

interface Pending {
  id: number
  frame: number
  profileId: string
  seed: number
  plan: MotionPlanIdentity
  resolve: (chunk: MotionChunk) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

/** One Main-owned ARDY process. No renderer paths or arbitrary descriptions. */
export class ArdyMotionService {
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
  private startingAvatar: number | null = null

  private assetHandle = ''
  constructor(
    private readonly root: string,
    private readonly currentAssetHandle: () => string = () => '',
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
    }
  }

  warmup(): Promise<void> {
    if (this.startup) return this.startup
    if (this.process && this.state === 'ready') return Promise.resolve()
    this.startup = this.initialize().finally(() => {
      this.startup = null
    })
    return this.startup
  }

  private async initialize(): Promise<void> {
    if (this.closed) throw new Error('ARDY_CLOSED')
    if (this.stopping) await this.stopping
    if (this.closed) throw new Error('ARDY_CLOSED')
    const python = join(
      this.root,
      '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    )
    if (!existsSync(python) || !existsSync(join(this.root, 'worker.py'))) {
      this.state = 'unavailable'
      this.error = 'ARDY_ASSETS_MISSING'
      throw new Error(this.error)
    }
    this.state = 'loading'
    this.error = null
    const environment: Record<string, string> = {
      PYTHONUTF8: '1',
      PYTHONUNBUFFERED: '1',
      HF_HUB_OFFLINE: '1',
      TRANSFORMERS_OFFLINE: '1',
      TORCH_HOME: join(this.root, '.cache', 'torch'),
      TEMP: join(this.root, '.tmp'),
      TMP: join(this.root, '.tmp'),
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
    const child = spawn(python, [join(this.root, 'worker.py')], {
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
        reject(new Error('ARDY_INIT_TIMEOUT'))
        void this.stopProcess('ARDY_INIT_TIMEOUT')
      }, 600_000)
      child.stdout.on('data', (data: Buffer) => {
        if (this.process !== child) return
        buffer += data.toString('utf8')
        if (Buffer.byteLength(buffer) > 262_144) {
          void this.stopProcess('ARDY_PROTOCOL_ERROR')
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
            if (value.type === 'ready' && !started && motionReadySchema.safeParse(value).success) {
              started = true
              clearTimeout(deadline)
              this.state = 'ready'
              resolve()
              continue
            }
            if (value.type === 'error') throw new Error('ARDY_INFERENCE_FAILED')
            const chunk = motionChunkSchema.parse(value)
            const pending = this.pending
            if (
              !pending ||
              chunk.id !== pending.id ||
              chunk.profileId !== pending.profileId ||
              chunk.seed !== pending.seed ||
              chunk.avatarGeneration !== this.lease?.avatarGeneration ||
              JSON.stringify(chunk.plan) !== JSON.stringify(pending.plan) ||
              chunk.fromFrame !== pending.frame ||
              !this.matches(chunk) ||
              chunk.startFrame !== pending.frame
            )
              throw new Error('ARDY_STALE_OR_INVALID_CHUNK')
            this.expectedFrame = chunk.startFrame + chunk.rotations.length
            clearTimeout(pending.timeout)
            this.pending = null
            this.state = 'ready'
            pending.resolve(chunk)
          } catch {
            void this.stopProcess('ARDY_PROTOCOL_ERROR')
          }
        }
      })
      // Drain provider stderr without projecting model output or paths to renderer/debug.
      child.stderr.on('data', () => undefined)
      child.once('error', () => {
        clearTimeout(deadline)
        reject(new Error('ARDY_PROCESS_FAILED'))
        void this.stopProcess('ARDY_PROCESS_FAILED')
      })
      child.once('exit', () => {
        clearTimeout(deadline)
        if (!started) reject(new Error('ARDY_INIT_FAILED'))
        if (this.process === child) {
          this.process = null
          this.rejectPending('ARDY_PROCESS_EXITED')
          if (!this.stopping) {
            this.state = 'failed'
            this.error = 'ARDY_PROCESS_EXITED'
          }
        }
      })
    })
  }

  async start(owner: number, avatarGeneration: number, seed?: number): Promise<MotionLease> {
    if (this.owner !== null) throw new Error('ARDY_BUSY')
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
      throw new Error('ARDY_CANCELLED')
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
  ): Promise<MotionChunk> {
    if (
      !this.owns(owner, lease) ||
      lease.seed !== this.lease?.seed ||
      lease.avatarGeneration !== this.lease?.avatarGeneration
    )
      throw new Error('ARDY_STALE_SESSION')
    const profile = getMotionProfile(profileId)
    const parsedPlan = motionPlanIdentitySchema.safeParse(requestedPlan)
    if (!profile || !parsedPlan.success) throw new Error('ARDY_INVALID_PLAN')
    const plan = parsedPlan.data
    if (
      plan.handScoreRevision !== profile.handScore.revision ||
      plan.handRigCalibrationRevision !== profile.handScore.calibrationRevision
    )
      throw new Error('ARDY_INCOMPATIBLE_HAND_SCORE')
    const previous = this.acceptedPlan
    if (this.retiredExecutions.includes(plan.executionId)) throw new Error('ARDY_STALE_PLAN')
    if (previous) {
      const sameExecution = previous.executionId === plan.executionId
      if (
        previous.continuityAnchor !== plan.continuityAnchor ||
        (sameExecution &&
          (plan.planRevision < previous.planRevision ||
            MOTION_PHASE_IDS.indexOf(plan.phaseId) < MOTION_PHASE_IDS.indexOf(previous.phaseId) ||
            this.acceptedProfile !== profileId ||
            (plan.planRevision === previous.planRevision &&
              (plan.clockDomain !== previous.clockDomain ||
                plan.playbackId !== previous.playbackId)))) ||
        (!sameExecution && plan.phaseId !== 'prepare')
      )
        throw new Error('ARDY_STALE_PLAN')
    }
    if (this.pending) throw new Error('ARDY_BUSY')
    const child = this.process
    if (!child || this.state !== 'ready') throw new Error('ARDY_NOT_READY')
    const id = ++this.requestId
    const frame = requestedFrame ?? this.expectedFrame
    if (
      frame % 4 !== 0 ||
      frame < Math.max(0, this.expectedFrame - 120) ||
      frame > this.expectedFrame
    )
      throw new Error('ARDY_INVALID_REPLAN')
    if (previous && previous.executionId !== plan.executionId) {
      this.retiredExecutions.push(previous.executionId)
      if (this.retiredExecutions.length > 8) this.retiredExecutions.shift()
    }
    this.acceptedPlan = plan
    this.acceptedProfile = profileId
    this.state = 'generating'
    const generation = new Promise<MotionChunk>((resolve, reject) => {
      const timeout = setTimeout(() => {
        void this.stopProcess('ARDY_DEADLINE_MISS')
      }, MOTION_INFERENCE_DEADLINE_MS)
      this.pending = { id, frame, profileId, seed: lease.seed, plan, resolve, reject, timeout }
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
      }
      child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (error) void this.stopProcess('ARDY_CHANNEL_FAILED')
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
      throw new Error('ARDY_STALE_SESSION')
    if (seed !== undefined && !motionSeedSchema.safeParse(seed).success)
      throw new Error('ARDY_INVALID_SEED')
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
    await this.stopProcess('ARDY_CANCELLED')
    return true
  }

  async releaseOwner(owner: number): Promise<void> {
    if (owner === this.owner) await this.stopProcess('ARDY_CANCELLED')
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
    this.stopping = new Promise<void>((resolve, reject) => {
      if (!child || child.exitCode !== null) {
        resolve()
        return
      }
      const deadline = setTimeout(() => reject(new Error('ARDY_TERMINATION_FAILED')), 5000)
      child.once('exit', () => {
        clearTimeout(deadline)
        if (this.process === child) this.process = null
        resolve()
      })
      child.kill('SIGKILL')
    }).then(() => {
      this.stopping = null
      this.state = this.closed ? 'closed' : 'unavailable'
    })
    // Every detached failure is contained and represented in owned state.
    void this.stopping.catch(() => {
      this.state = 'failed'
      this.error = 'ARDY_TERMINATION_FAILED'
    })
    return this.stopping
  }

  async dispose(): Promise<void> {
    this.closed = true
    await this.stopProcess('ARDY_CLOSED')
  }
}
