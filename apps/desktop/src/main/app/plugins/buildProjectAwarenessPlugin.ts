import {
  ProjectAwarenessPlugin,
  type ProjectAwarenessPluginDependencies,
} from '../../project-awareness'

export function buildProjectAwarenessPlugin(
  dependencies: ProjectAwarenessPluginDependencies,
): ProjectAwarenessPlugin {
  return new ProjectAwarenessPlugin(dependencies)
}
