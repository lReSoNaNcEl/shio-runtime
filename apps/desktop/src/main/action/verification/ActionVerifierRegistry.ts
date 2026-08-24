import type { ActionVerifier } from './contracts'

export class ActionVerifierRegistry {
  private readonly verifiers = new Map<string, ActionVerifier>()

  register(verifier: ActionVerifier): void {
    this.verifiers.set(verifier.id, verifier)
  }

  resolve(id: string): ActionVerifier | undefined {
    return this.verifiers.get(id)
  }
}
