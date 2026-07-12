import type { ChatMessage } from '../public/chatTypes'
import type { LlmCapabilities } from './capabilities'

/**
 * Adapt Runtime messages to a provider that does not support the system role
 * by folding leading system turns into the first user turn. For providers that
 * do support it (all current ones) the messages pass through unchanged and
 * exactly once - never dropped, duplicated, or role-converted.
 */
export function prepareMessages(messages: ChatMessage[], caps: LlmCapabilities): ChatMessage[] {
  if (caps.supportsSystemPrompt) return messages
  const systemText = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const rest = messages.filter((m) => m.role !== 'system')
  if (!systemText) return rest
  const firstUserIdx = rest.findIndex((m) => m.role === 'user')
  if (firstUserIdx === -1) return [{ role: 'user', content: systemText }, ...rest]
  const merged = [...rest]
  merged[firstUserIdx] = {
    role: 'user',
    content: `${systemText}\n\n${merged[firstUserIdx].content}`,
  }
  return merged
}
