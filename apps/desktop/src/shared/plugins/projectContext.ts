import type {
  ActiveProjectContextRequirement,
  ProjectContextPacket,
  ProjectContextRequirement,
} from '../project-awareness'

export interface ProjectContextRequest {
  userText: string
  traceId?: string
}

export interface ProjectContextBuildRequest extends ProjectContextRequest {
  requirement: ActiveProjectContextRequirement
}

export interface ProjectContextProvider {
  resolveRequirement(request: ProjectContextRequest): ProjectContextRequirement
  buildContext(request: ProjectContextBuildRequest): Promise<ProjectContextPacket | null>
}

export type ProjectContextProviderResolver = () => ProjectContextProvider | undefined
