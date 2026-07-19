export type AttentionMode = 'silent' | 'passive' | 'active' | 'streamer'

export type BacklogPriorityClass = 'P0' | 'P1' | 'P2' | 'P3' | 'P4'

export interface BufferedUtterance {
  id: string
  text: string
  createdAt: number
  expiresAt: number
  streamingSessionId: string
  segmentId?: string
  directAddress: boolean
  question: boolean
  correctionHint: boolean
  followUpHint: boolean
  attentionScore: number
  attentionMode: AttentionMode
  capturedWhileShioBusy: boolean
  capturedDuringPlayback: boolean
  likelySelfEcho: boolean
  triggeredBargeIn: boolean
  priorityClass: BacklogPriorityClass
}

export interface BacklogSelectionResult {
  action: 'select' | 'merge' | 'discard_all'
  selectedIds: string[]
  text?: string
  reason: string
  confidence: number
  backlogVersion: number
}
