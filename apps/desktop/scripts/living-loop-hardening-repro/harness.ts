import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { ActionPermissionGuard } from '../../src/main/action'
import { AliveRuntime, AliveStore, SchedulerRuntime } from '../../src/main/alive'
import { CharacterToolRegistry } from '../../src/main/character-tools/CharacterToolRegistry'
import { DesktopControlPlugin, ShellRiskPolicy } from '../../src/main/desktop-control'
import { actionConfirmationRequestSchema } from '../../src/shared/actions'

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

function shellPolicy(): void {
  const policy = new ShellRiskPolicy()
  assert.deepEqual(policy.classify('Get-Process | Select-Object Name'), {
    classification: 'read-only',
    effectiveRisk: 'normal',
    commands: ['Get-Process', 'Select-Object'],
    reason: 'parsed_read-only',
  })
  assert.equal(
    policy.classify('Set-Content -Path note.txt -Value ready').classification,
    'mutating',
  )
  assert.equal(policy.classify('Remove-Item note.txt').effectiveRisk, 'destructive')
  assert.equal(policy.classify('Invoke-Expression $command').classification, 'unknown')

  const plugin = new DesktopControlPlugin({
    adapter: { onChanged: () => () => undefined },
    browser: { observationSnapshot: () => null },
    authorityMode: () => 'full',
  } as never)
  const reclassified = plugin.validateWorkflowRequest({
    type: 'desktop.workflow',
    goal: 'Delete the exact temporary file',
    shellCommand: 'Remove-Item note.txt',
    requestedCapabilities: ['shell'],
    risk: 'normal',
  })
  assert.equal(reclassified.risk, 'destructive')
  assert.equal(reclassified.shellRisk?.classification, 'destructive')

  const registry = new CharacterToolRegistry({
    projectAvailable: false,
    capabilityContext: {
      schemaVersion: 1,
      generatedAt: 1,
      capabilities: [
        {
          id: 'computer-control',
          category: 'action',
          source: { kind: 'plugin', pluginId: 'desktop-control' },
          titleKey: 'capabilities.computer.title',
          descriptionKey: 'capabilities.computer.description',
          availability: 'available',
          authority: 'full',
        },
      ],
    },
    browserObservation: null,
    actionsAvailable: true,
  })
  const shell = registry.definitions().find((tool) => tool.id === 'shell.execute')
  assert(shell)
  const properties = shell.inputSchema.properties as Record<string, unknown>
  assert.equal('risk' in properties, false, 'Character LLM can still choose Shell risk')
}

async function fullControlDestructiveConfirmation(): Promise<void> {
  let confirmations = 0
  const guard = new ActionPermissionGuard({
    authorityMode: () => 'full',
    requestConfirmation: async () => {
      confirmations += 1
      return 'confirm'
    },
  })
  const confirmation = actionConfirmationRequestSchema.parse({
    schemaVersion: 1,
    actionId: 'action-1-00000000-0000-4000-8000-000000000000',
    tool: 'desktop.workflow',
    goal: 'Delete the exact temporary file',
    shellCommand: 'Remove-Item note.txt',
    requestedCapabilities: ['shell'],
    risk: 'destructive',
  })
  assert.equal(await guard.authorize('desktop-workflow', confirmation), 'confirmed')
  assert.equal(confirmations, 1, 'Full Control bypassed destructive confirmation')
  assert.equal(
    await guard.authorize('desktop-workflow', { ...confirmation, risk: 'normal' }),
    'full',
  )
  assert.equal(confirmations, 1)
}

async function nonOverlappingScheduler(): Promise<void> {
  const scheduler = new SchedulerRuntime(5)
  let active = 0
  let maximumActive = 0
  let ticks = 0
  scheduler.start(async () => {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    ticks += 1
    await wait(20)
    active -= 1
  })
  await wait(72)
  scheduler.dispose()
  await wait(25)
  assert(ticks >= 2)
  assert.equal(maximumActive, 1, 'Scheduler started an overlapping tick')
  assert.equal(scheduler.isRunning(), false)
}

async function completedOnlyHabitEvidence(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'shio-living-loop-hardening-'))
  const databasePath = join(directory, 'alive.sqlite')
  try {
    const store = new AliveStore(databasePath)
    store.saveSettings({
      ...store.settings(),
      mode: 'full',
      cooldownMs: 0,
      maxDailyInitiatives: 10,
    })
    const task = store.createTask({
      title: 'Observe completion',
      kind: 'check_in',
      dueAt: Date.now() - 1,
    })
    const runtime = new AliveRuntime(store, () => ({}) as never, {
      onCompletedExperienceFact: () =>
        store.observeHabit('task-follow-through', 'Task follow-through'),
    })
    runtime.start()
    await wait(30)
    const database = new DatabaseSync(databasePath)
    const countEvidence = (): number =>
      Number(
        (
          database
            .prepare(
              "SELECT evidence_count FROM alive_habits WHERE habit_key = 'task-follow-through'",
            )
            .get() as { evidence_count?: number } | undefined
        )?.evidence_count ?? 0,
      )
    assert.equal(countEvidence(), 0, 'Starting a task created completion evidence')
    runtime.reportExperience({ type: 'task-completed', at: Date.now(), taskId: task.id })
    assert.equal(countEvidence(), 1)
    database.close()
    runtime.dispose()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  shellPolicy()
  await fullControlDestructiveConfirmation()
  await nonOverlappingScheduler()
  await completedOnlyHabitEvidence()
  console.log('LIVING LOOP HARDENING REPRO PASS: shell policy, permission, scheduler, habits')
}

void main()
