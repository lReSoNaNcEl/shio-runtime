import type { ApplicationDependencies } from './buildApplicationDependencies'

export function shutdownApplication(dependencies: ApplicationDependencies): void {
  dependencies.shutdown()
}
