import type { ProjectContextPacket, ProjectSearchInput } from '../project-awareness'

export interface ProjectContextSearchRequest extends ProjectSearchInput {
  traceId?: string
}

export interface ProjectContextProvider {
  search(request: ProjectContextSearchRequest): Promise<ProjectContextPacket | null>
}

export type ProjectContextProviderResolver = () => ProjectContextProvider | undefined
