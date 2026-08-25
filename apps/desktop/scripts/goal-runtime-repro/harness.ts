import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  AliveStore,
  AutonomyScopeRuntime,
  EventWatchService,
  GoalRuntime,
} from '../../src/main/alive'

function main(): void {
  const directory = mkdtempSync(join(tmpdir(), 'shio-goal-runtime-'))
  const path = join(directory, 'alive.sqlite')
  try {
    let store = new AliveStore(path)
    let goals = new GoalRuntime(store)
    const goal = goals.create({ title: 'Compare Node versions', owner: 'shared' })
    goals.plan(goal.id, ['Find current release', 'Inspect installed version'], { now: 100 })
    assert.equal(goals.attentionCandidates(101).length, 1)
    goals.admitStep(goal.id, 110)
    goals.noteToolCall(goal.id, 111)
    goals.awaitVerification(goal.id, 112)
    let state = goals.recordVerifiedResult({
      goalId: goal.id,
      actionId: 'web-1',
      verified: true,
      at: 120,
    })
    assert.equal(state.phase, 'planning')
    assert.equal(store.goals()[0]?.progress, 0.5)
    goals.waitForEvent(goal.id, { kind: 'world-event', eventType: 'network-restored' }, 130)
    store.close()

    store = new AliveStore(path)
    goals = new GoalRuntime(store)
    goals.restore({ ...store.settings(), mode: 'full', globallySuspended: false }, 140)
    assert.equal(goals.executionSnapshot()[0]?.phase, 'waiting-event')
    const watches = new EventWatchService(store, goals)
    assert.equal(
      watches.observe({ kind: 'world-event', eventType: 'network-restored', at: 150 }).length,
      1,
    )
    assert.equal(goals.executionSnapshot()[0]?.phase, 'planning')
    goals.admitStep(goal.id, 160)
    goals.awaitVerification(goal.id, 161)
    state = goals.recordVerifiedResult({
      goalId: goal.id,
      actionId: 'shell-1',
      verified: true,
      at: 170,
    })
    assert.equal(state.phase, 'completed')
    assert.equal(store.goals()[0]?.progress, 1)
    assert.equal(store.goals()[0]?.status, 'completed')

    const bounded = goals.create({ title: 'Bounded work' })
    goals.plan(bounded.id, ['Only step'], { budget: { maxToolCalls: 1 }, now: 200 })
    goals.admitStep(bounded.id, 201)
    goals.noteToolCall(bounded.id, 202)
    assert.throws(() => goals.noteToolCall(bounded.id, 203), /GOAL_EXECUTION_BUDGET_EXCEEDED/u)
    assert.equal(
      goals.executionSnapshot().find((item) => item.goalId === bounded.id)?.phase,
      'failed',
    )

    const pausable = goals.create({ title: 'Pause and resume safely' })
    goals.plan(pausable.id, ['Wait for explicit resume'], { now: 210 })
    goals.update({ id: pausable.id, status: 'paused' })
    assert.equal(
      goals.executionSnapshot().find((item) => item.goalId === pausable.id)?.phase,
      'paused',
    )
    goals.update({ id: pausable.id, status: 'active' })
    assert.equal(
      goals.executionSnapshot().find((item) => item.goalId === pausable.id)?.phase,
      'idle',
    )

    const legacyCompleted = goals.create({ title: 'Legacy completed checkpoint' })
    goals.plan(legacyCompleted.id, ['Already completed elsewhere'], { now: 220 })
    store.updateGoal({ id: legacyCompleted.id, status: 'completed', progress: 1 })
    goals.pauseAutonomousWork('application-exit', 221)
    assert.equal(
      goals.snapshot().find((item) => item.id === legacyCompleted.id)?.status,
      'completed',
      'Shutdown resurrected a completed goal as paused',
    )
    assert.equal(
      goals.executionSnapshot().find((item) => item.goalId === legacyCompleted.id)?.phase,
      'completed',
      'Shutdown did not normalize a stale completed checkpoint',
    )

    const scopes = new AutonomyScopeRuntime(store)
    scopes.approve(
      {
        goalId: bounded.id,
        allowedOrigins: ['https://nodejs.org/docs'],
        maxActions: 1,
        allowedRiskClasses: ['read-only'],
      },
      'explicit-user-approval',
      300,
    )
    assert.equal(
      scopes.authorizeAndConsume(
        bounded.id,
        { origin: 'https://nodejs.org/en', risk: 'read-only' },
        301,
      ),
      true,
    )
    assert.equal(
      scopes.authorizeAndConsume(
        bounded.id,
        { origin: 'https://evil.example', risk: 'read-only' },
        302,
      ),
      false,
    )
    assert.equal(
      scopes.authorizeAndConsume(
        bounded.id,
        { origin: 'https://nodejs.org', risk: 'mutating' },
        303,
      ),
      false,
    )

    for (const source of ['GoalRuntime.ts', 'EventWatchService.ts']) {
      const text = readFileSync(join(process.cwd(), 'src/main/alive', source), 'utf8')
      assert.doesNotMatch(text, /ActionRuntime|DesktopControl|BrowserAdapter|ShellAdapter/u)
    }
    store.close()
    console.log('GOAL RUNTIME REPRO PASS: checkpoint, restart, event wake, budgets, scopes')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

main()
