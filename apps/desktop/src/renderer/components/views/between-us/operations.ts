export type BetweenUsOperation =
  | { kind: 'create-goal' }
  | { kind: 'create-task' }
  | { kind: 'goal-update'; id: string }
  | { kind: 'task-update'; id: string }

export type RunBetweenUsOperation = (
  operation: BetweenUsOperation,
  work: () => Promise<unknown>,
) => Promise<boolean>
