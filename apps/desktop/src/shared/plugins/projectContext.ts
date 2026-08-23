import type { ProjectContextPacket } from '../project-awareness'

export interface ProjectContextRequest {
  userText: string
}

export interface ProjectContextProvider {
  buildContext(request: ProjectContextRequest): Promise<ProjectContextPacket | null>
}

export type ProjectContextProviderResolver = () => ProjectContextProvider | undefined
