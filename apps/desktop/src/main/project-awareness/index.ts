export { isAllowedProjectPath, isSafeTextContent } from './indexing/SourceFilter'
export { extractSource } from './indexing/SymbolExtractor'
export {
  defaultProjectAwarenessPluginConfig,
  ProjectAwarenessConfigStore,
  type ProjectAwarenessPluginConfig,
} from './ProjectAwarenessConfigStore'
export {
  PROJECT_AWARENESS_MANIFEST,
  ProjectAwarenessPlugin,
  type ProjectAwarenessPluginDependencies,
} from './ProjectAwarenessPlugin'
export type { ProjectAwarenessRuntimeConfig } from './ProjectAwarenessRuntime'
export { ProjectAwarenessRuntime } from './ProjectAwarenessRuntime'
export {
  type LoadedProjectCredential,
  type ProjectCredentialProtector,
  ProjectCredentialStore,
} from './ProjectCredentialStore'
export { ProjectKnowledgeStore } from './ProjectKnowledgeStore'
export { isProjectRelevantRequest } from './ProjectRelevanceGate'
