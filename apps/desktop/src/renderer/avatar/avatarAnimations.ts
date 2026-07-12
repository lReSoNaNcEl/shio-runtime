export const DEBUG_AVATAR_MODES = ['idle', 'listening', 'thinking'] as const

export type DebugAvatarMode = (typeof DEBUG_AVATAR_MODES)[number]

export const DEBUG_AVATAR_MODE_LABELS: Record<DebugAvatarMode, string> = {
  idle: 'покой',
  listening: 'слушает',
  thinking: 'думает',
}
