import type { ApplicationDependencies } from './buildApplicationDependencies'

export async function initializeApplication(dependencies: ApplicationDependencies): Promise<void> {
  await dependencies.initialize()
}
