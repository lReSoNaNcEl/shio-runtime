export type ConversationThreadStatus =
  | 'active'
  | 'interrupted'
  | 'waiting-user'
  | 'dormant'
  | 'resolved'
  | 'expired'

export interface ConversationThread {
  id: string
  topic: string
  summary: string
  status: ConversationThreadStatus
  sourceTurnId: string
  createdAt: number
  updatedAt: number
  expiresAt: number
  salience: number
}

export interface OpenConversationThreadInput {
  topic: string
  summary: string
  status?: Extract<ConversationThreadStatus, 'active' | 'interrupted' | 'waiting-user' | 'dormant'>
  salience?: number
}

export interface ConversationThreadRuntimePort {
  awareness(now?: number): readonly ConversationThread[]
  open(input: OpenConversationThreadInput, sourceTurnId: string, now?: number): ConversationThread
  resolve(id: string, now?: number): ConversationThread
}
