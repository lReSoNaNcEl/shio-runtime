export type RuntimeEventCategory = 'speech' | 'character' | 'avatar' | 'action' | 'experience' | 'system'

export type RuntimeEventType =
  | 'RuntimeInitialized'
  | 'ListeningStarted'
  | 'ListeningFinished'
  | 'RecognitionCompleted'
  | 'SentenceGenerated'
  | 'SpeechStarted'
  | 'SpeechFinished'
  | 'ModeChanged'
  | 'EmotionChanged'
  | 'ActivityChanged'
  | 'AnimationStarted'
  | 'AnimationFinished'
  | 'GestureStarted'
  | 'GestureFinished'
  | 'ToolRequested'
  | 'ToolCompleted'
  | 'ToolFailed'
  | 'RuntimeDebugEvent'

export interface RuntimeEvent {
  id: string
  type: RuntimeEventType
  category: RuntimeEventCategory
  occurredAt: number
  source: string
  detail?: string
  metadata?: Readonly<Record<string, string | number | boolean>>
}

export type RuntimeEventInput = Omit<RuntimeEvent, 'id' | 'occurredAt'>

export interface EventBus {
  publish(event: RuntimeEventInput): RuntimeEvent
  subscribe(listener: (event: RuntimeEvent) => void): () => void
  getHistory(): readonly RuntimeEvent[]
  clearHistory(): void
}
