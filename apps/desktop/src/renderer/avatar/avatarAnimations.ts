export const DEBUG_AVATAR_MODES = ['idle', 'listening', 'thinking'] as const

export type DebugAvatarMode = (typeof DEBUG_AVATAR_MODES)[number]
