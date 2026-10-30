/** A descriptive Fish instruction, never executable text or nested provider tags. */
export const VOICE_STYLE_MAX_LENGTH = 120

export function normalizeVoiceStyle(value: string): string | undefined {
  const style = value.trim()
  if (!style || style.length > VOICE_STYLE_MAX_LENGTH || /[\p{C}[\]<>]/u.test(style))
    return undefined
  return style
}
